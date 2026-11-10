'use strict';
const S = [1, 2].map(k => ({ id: k, text: 't' + k, count: k + 1, open: k > 1 }));
const seen = [];
function keep(o) { seen[0] = o; return o.count; }
function step(state, i) { return keep({ ...state, name0: i, name1: i, name2: i, name3: i, name4: i }); }
function f(t) { let s = 0; for (let i = 0; i < 4; i++) s += step(S[i & 1], i); return s; }
globalThis.kept = [f, keep];
const n = +process.argv[2]; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(sum);
