'use strict';
const seed = JSON.parse('[0.5, 1.5]'), hold = { it: null };
function f(t0) { const out = [seed[0], seed[1], 2.5]; const add = x => { out.push(x + 1); }; for (let i = 0; i < out.length && i < 8; i++) add(out[i]); return out.join(); }
let all = ''; for (let t = 0; t < 60; t++) { const r = String(f(t)); if (t < 2 || t > 57) all += r + '\n'; else all += r.length + ' '; } console.log(all);
