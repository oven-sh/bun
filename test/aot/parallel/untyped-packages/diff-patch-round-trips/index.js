// patches of text in unified form read by expressions, applied, reversed, merged; conflicts marked
'use strict';
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: (.*))?$/, FILE = /^(---|\+\+\+) (?:[ab]\/)?([^\t\n]+)(?:\t(.*))?$/, BODY = /^([ +\-\\])(.*)$/;
function parse(text) {
  const files = []; let file = null, hunk = null, left = 0, right = 0;
  text.split('\n').forEach((line, n) => {
    let m;
    if (hunk && (left > 0 || right > 0) && (m = BODY.exec(line))) { const [, k, t] = m; if (k === '\\') return; hunk.lines.push({ k, t }); if (k !== '+') left--; if (k !== '-') right--; return; }
    if ((m = HUNK.exec(line))) { if (!file) throw new SyntaxError('hunk without a file at ' + (n + 1)); const v = []; for (let i = 1; i < 5; i++) v.push(m[i] === undefined ? 1 : +m[i]); hunk = { from: v[0], take: v[1], to: v[2], put: v[3], note: m[5], lines: [] }; left = v[1]; right = v[3]; file.hunks.push(hunk); return; }
    if ((m = FILE.exec(line))) { if (m[1] === '---') files.push(file = { old: m[2], now: null, stamp: m[3], hunks: [] }); else if (file) file.now = m[2]; hunk = null; return; }
    if (line.trim() && hunk) throw new SyntaxError('stray line ' + (n + 1) + ': ' + line);
  });
  return files;
}
function apply(text, hunks, fuzz = 2) {
  const lines = text.split('\n'), rejects = []; let shift = 0;
  for (const h of hunks) {
    const want = h.lines.filter(l => l.k !== '+').map(l => l.t), put = h.lines.filter(l => l.k !== '-').map(l => l.t), at = h.from - 1 + shift + (h.take === 0 ? 1 : 0);
    let found = -1;
    search: for (let d = 0; d <= fuzz * 3; d++) for (const s of d ? [-d, d] : [0]) { const p = at + s; if (p < 0 || p + want.length > lines.length) continue; let ok = true; for (let i = 0; i < want.length && ok; i++) ok = lines[p + i] === want[i]; if (ok) { found = p; break search; } }
    if (found < 0) { rejects.push(h.from); continue; }
    lines.splice(found, want.length, ...put); shift += put.length - want.length + (found - at);
  }
  return { text: lines.join('\n'), rejects };
}
const reverse = hunks => hunks.map(h => ({ ...h, from: h.to, take: h.put, to: h.from, put: h.take, lines: h.lines.map(l => ({ ...l, k: l.k === '+' ? '-' : l.k === '-' ? '+' : ' ' })) }));
function diff(a, b, context = 1) {
  a = a.split('\n'); b = b.split('\n'); const n = a.length, m = b.length, max = n + m, v = { 1: 0 }, trace = [];
  outer: for (let d = 0; d <= max; d++) { trace.push({ ...v }); for (let k = -d; k <= d; k += 2) { let x = k === -d || k !== d && v[k - 1] < v[k + 1] ? v[k + 1] : v[k - 1] + 1, y = x - k; while (x < n && y < m && a[x] === b[y]) { x++; y++; } v[k] = x; if (x >= n && y >= m) break outer; } }
  const ops = []; let x = n, y = m; for (let d = trace.length - 1; d >= 0; d--) { const t = trace[d], k = x - y, pk = k === -d || k !== d && t[k - 1] < t[k + 1] ? k + 1 : k - 1, px = t[pk], py = px - pk; while (x > px && y > py && x > 0 && y > 0) { ops.push([' ', a[--x]]); y--; } if (d > 0) { if (x === px) ops.push(['+', b[--y]]); else ops.push(['-', a[--x]]); } } ops.reverse();
  const hunks = []; let i = 0, la = 1, lb = 1; while (i < ops.length) { if (ops[i][0] === ' ') { i++; la++; lb++; continue; } let s = i, ctx = 0; while (s > 0 && ops[s - 1][0] === ' ' && ctx < context) { s--; ctx++; } let e = i, quiet = 0; while (e < ops.length && quiet <= context * 2) { quiet = ops[e][0] === ' ' ? quiet + 1 : 0; e++; } e -= Math.max(0, quiet - context); const lines = ops.slice(s, e).map(([k, t]) => ({ k, t })), take = lines.filter(l => l.k !== '+').length, put = lines.filter(l => l.k !== '-').length; hunks.push({ from: la - ctx, take, to: lb - ctx, put, lines }); for (; i < e; i++) { if (ops[i][0] !== '+') la++; if (ops[i][0] !== '-') lb++; } } return hunks;
}
const print = (name, hunks) => '--- a/' + name + '\n+++ b/' + name + '\n' + hunks.map(h => '@@ -' + h.from + (h.take === 1 ? '' : ',' + h.take) + ' +' + h.to + (h.put === 1 ? '' : ',' + h.put) + ' @@\n' + h.lines.map(l => l.k + l.t).join('\n')).join('\n') + '\n';
function merge3(base, mine, theirs) { const b = base.split('\n'), edits = o => { const out = []; for (const h of diff(base, o, 0)) out.push({ at: h.take ? h.from - 1 : h.from - 1, n: h.take, put: h.lines.filter(l => l.k === '+').map(l => l.t) }); return out; }, A = edits(mine), B = edits(theirs), out = []; let i = 0, x = 0, y = 0, conflicts = 0; while (i <= b.length) { const p = A[x] && A[x].at === i ? A[x] : null, q = B[y] && B[y].at === i ? B[y] : null; if (p && q) { if (p.put.join('\n') === q.put.join('\n') && p.n === q.n) out.push(...p.put); else { conflicts++; out.push('<<<<<<<', ...p.put, '=======', ...q.put, '>>>>>>>'); } i += Math.max(p.n, q.n); x++; y++; if (!p.n && !q.n) { if (i < b.length) out.push(b[i]); i++; } continue; } const e = p || q; if (e) { out.push(...e.put); i += e.n; if (p) x++; else y++; if (!e.n) { if (i < b.length) out.push(b[i]); i++; } continue; } if (i < b.length) out.push(b[i]); i++; } return { text: out.join('\n'), conflicts }; }
module.exports = { parse, apply, reverse, diff, print, merge3 };
