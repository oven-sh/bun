'use strict';
const seed = JSON.parse('[0.5, 1.5]'), hold = { it: null };
function f(t0) { const p = { n: 0, s: 0 }; const bump = x => { p.n++; p.s += x; }; const l = [seed[0], seed[1], 2.5, 3.5]; for (let i = 0; i < l.length; i++) bump(l[i]); return p.n + '|' + p.s; }
let all = ''; for (let t = 0; t < 60; t++) { const r = String(f(t)); if (t < 2 || t > 57) all += r + '\n'; else all += r.length + ' '; } console.log(all);
