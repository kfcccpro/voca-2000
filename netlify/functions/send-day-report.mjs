// 학습 허브 통합 DAY 보고 메일 함수
// root_18day 와 2000_18DAY 두 앱이 같은 경로(/.netlify/functions/send-day-report)를 사용하므로
// 하나의 함수에서 두 가지 payload 형태를 모두 처리한다.
//
// 필요한 환경 변수
//   RESEND_API_KEY      (필수)
//   REPORT_FROM_EMAIL   (필수)  예: report@yourdomain.com
//   ADMIN_REPORT_EMAIL  (선택)  미설정 시 아래 기본 주소 사용
//
// 보안: 수신 주소는 반드시 서버에서 결정한다.
//       요청 본문의 주소를 신뢰하면 누구나 이 함수를 공개 메일 릴레이로 악용할 수 있다.

const DEFAULT_ADMIN_EMAIL = 'sk01197375068@gmail.com';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function row(label, value) {
  return `<tr><th style="text-align:left;padding:10px;border-bottom:1px solid #d9e0ec;white-space:nowrap">${escapeHtml(label)}</th><td style="padding:10px;border-bottom:1px solid #d9e0ec">${escapeHtml(value)}</td></tr>`;
}

function shell(title, subtitle, rows, extra = '') {
  return `<div style="font-family:Arial,'Noto Sans KR',sans-serif;color:#172235;line-height:1.65;max-width:700px;margin:auto">
    <h2 style="margin-bottom:6px">${escapeHtml(title)}</h2>
    <p style="color:#667287;margin-top:0">${escapeHtml(subtitle)}</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0"><tbody>${rows}</tbody></table>
    ${extra}
  </div>`;
}

/* ---------- 2000_18DAY 형식 ---------- */
function buildVoca(report) {
  const s = report.summary || {};
  const rows = [
    row('학습 단어', `${s.words ?? '-'}개`),
    row('본 시험 정답률', `${s.accuracy ?? '-'}%`),
    row('본 시험 오답', `${s.wrong ?? '-'}개`),
    row('활성 오답', `${s.active_wrong ?? '-'}개`),
    row('누적 오답 발생', `${s.cumulative_wrong ?? '-'}회`),
  ].join('');
  const text = escapeHtml(report.report_text || '').replaceAll('\n', '<br>');
  const extra = text ? `<div style="background:#f4f6fb;border-radius:12px;padding:16px;font-size:14px">${text}</div>` : '';
  const title = `WORD MASTER 2000 · DAY ${String(report.day).padStart(2, '0')} 완료`;
  return { subject: title, html: shell(title, `보고 시각: ${report.report_date || ''}`, rows, extra) };
}

/* ---------- root_18day 형식 ---------- */
function buildRoot(report) {
  const s = report.summary || {};
  const accuracy = s.accuracy === null || s.accuracy === undefined ? '미측정' : `${s.accuracy}%`;
  const rows = [
    row('학습 ROOT', `${s.roots ?? '-'}개`),
    row('학습 단어', `${s.words ?? '-'}개`),
    row('응답', `${s.attempted ?? '-'}`),
    row('정답', `${s.correct ?? '-'}`),
    row('오답', `${s.wrong ?? '-'}`),
    row('정확도', accuracy),
    row('학습 시간', `${s.elapsed_minutes ?? '-'}분`),
    row('활성 복습', `${s.active_review_count ?? '-'}개`),
    row('D+1 / D+3 / D+6', `${s.d1_due ?? 0} / ${s.d3_due ?? 0} / ${s.d6_due ?? 0}`),
  ].join('');
  const wrongWords = Array.isArray(s.wrong_words) ? s.wrong_words : [];
  const extra = wrongWords.length
    ? `<p><strong>오답 단어</strong></p><p>${wrongWords.map(escapeHtml).join(', ')}</p>`
    : '<p><strong>오답 단어</strong>: 없음</p>';
  const title = `18day_root · DAY ${String(report.day).padStart(2, '0')} 완료`;
  return { subject: title, html: shell(title, `보고 시각: ${report.report_date || new Date().toLocaleString('ko-KR')}`, rows, extra) };
}

export default async function handler(request) {
  if (request.method !== 'POST') return json({ ok: false, reason: 'Method not allowed' }, 405);

  const apiKey = Netlify.env.get('RESEND_API_KEY');
  const from = Netlify.env.get('REPORT_FROM_EMAIL');
  const recipient = Netlify.env.get('ADMIN_REPORT_EMAIL') || DEFAULT_ADMIN_EMAIL;

  if (!apiKey || !from) {
    return json({ ok: false, queued: false, reason: 'Missing RESEND_API_KEY or REPORT_FROM_EMAIL' }, 503);
  }

  let report;
  try { report = await request.json(); }
  catch { return json({ ok: false, reason: 'Invalid JSON' }, 400); }

  if (!report?.day || !report?.summary) {
    return json({ ok: false, reason: 'day and summary are required' }, 400);
  }

  // 앱 판별: 2000_18DAY 는 report_id 가 wm2000- 으로 시작하고 report_text 를 함께 보낸다.
  const isVoca = String(report.report_id || '').startsWith('wm2000')
    || (typeof report.report_text === 'string' && report.summary.active_wrong !== undefined);
  const { subject, html } = isVoca ? buildVoca(report) : buildRoot(report);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [recipient], subject, html }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return json({ ok: false, reason: `Resend ${response.status}`, detail: detail.slice(0, 300) }, 502);
  }
  return json({ ok: true, app: isVoca ? '2000_18DAY' : 'root_18day', day: report.day });
}
