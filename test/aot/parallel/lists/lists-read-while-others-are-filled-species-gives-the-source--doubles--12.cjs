'use strict';
const N = 12, K = 5; let held = null; const box = { it: null };
const l = Array.from({ length: N }, (_, i) => i % 23 / 2 + 0.25);
const show = a => { let s = a.length + ':'; for (let i = 0; i < a.length; i++) s += (i in a ? String(a[i]) : '-') + ','; return s; };
function f(t) { class A extends Array { static get [Symbol.species]() { return function () { return held; }; } } const s = A.from(l); held = s; const m = s.map(x => x + 1); return show(m) + show(s) + (m === s); }
let all = ''; for (let t = 0; t < 40; t++) { const r = String(f(t)); if (t < 2 || t > 37) all += r + '\n'; else all += r.length + ' '; } console.log(all);
