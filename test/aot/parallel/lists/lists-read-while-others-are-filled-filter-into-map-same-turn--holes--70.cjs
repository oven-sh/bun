'use strict';
const N = 70, K = 40; let held = null; const box = { it: null };
const l = (() => { const a = []; for (let i = 0; i < N; i++) if (i % 5) a[i] = i + 0.5; return a; })();
const show = a => { let s = a.length + ':'; for (let i = 0; i < a.length; i++) s += (i in a ? String(a[i]) : '-') + ','; return s; };
function f(t) { const kept = []; const m = l.map((x, i) => { if (i & 1) kept.push(x); return kept.length + x; }); return show(m) + show(kept); }
let all = ''; for (let t = 0; t < 40; t++) { const r = String(f(t)); if (t < 2 || t > 37) all += r + '\n'; else all += r.length + ' '; } console.log(all);
