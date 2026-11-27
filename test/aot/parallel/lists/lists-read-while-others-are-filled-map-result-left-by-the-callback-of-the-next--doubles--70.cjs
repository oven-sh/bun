'use strict';
const N = 70, K = 40; let held = null; const box = { it: null };
const l = Array.from({ length: N }, (_, i) => i % 23 / 2 + 0.25);
const show = a => { let s = a.length + ':'; for (let i = 0; i < a.length; i++) s += (i in a ? String(a[i]) : '-') + ','; return s; };
function f(t) { let seen = null; const a = l.map(x => x + 1); seen = a; const b = a.map((x, i) => { if (i === K) seen[i + 1] = 'v'; return x; }); return show(a) + show(b); }
let all = ''; for (let t = 0; t < 40; t++) { const r = String(f(t)); if (t < 2 || t > 37) all += r + '\n'; else all += r.length + ' '; } console.log(all);
