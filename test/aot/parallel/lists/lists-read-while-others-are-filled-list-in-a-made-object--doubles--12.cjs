'use strict';
const N = 12, K = 5; let held = null; const box = { it: null };
const l = Array.from({ length: N }, (_, i) => i % 23 / 2 + 0.25);
const show = a => { let s = a.length + ':'; for (let i = 0; i < a.length; i++) s += (i in a ? String(a[i]) : '-') + ','; return s; };
function f(t) { const p = { list: l.slice() }; const out = []; for (let i = 0; i < p.list.length && i < 3 * N; i++) { out.push(p.list[i]); if (i === K) p.list = out; } return show(out); }
let all = ''; for (let t = 0; t < 40; t++) { const r = String(f(t)); if (t < 2 || t > 37) all += r + '\n'; else all += r.length + ' '; } console.log(all);
