'use strict';
const N = 70, K = 40; let held = null; const box = { it: null };
const l = Array.from({ length: N }, (_, i) => i % 23 / 2 + 0.25);
const show = a => { let s = a.length + ':'; for (let i = 0; i < a.length; i++) s += (i in a ? String(a[i]) : '-') + ','; return s; };
function f(t) { let prev = l, first = null; for (let o = 0; o < 3; o++) { const cur = new Array(prev.length); for (let i = 0; i < prev.length; i++) { cur[i] = prev[i] + o; if (first && i === K) first[i + 1] = 'w'; } first = first || cur; prev = cur; } return show(prev) + show(first); }
let all = ''; for (let t = 0; t < 40; t++) { const r = String(f(t)); if (t < 2 || t > 37) all += r + '\n'; else all += r.length + ' '; } console.log(all);
