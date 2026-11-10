// STATISTIC: RowsAskedForKindOfRowBesideThem >= 1
// The pairs are made by an arrow that knows nothing of x: their storage is contiguous. Two of them are read in a turn: where the first was found contiguous the second is asked for the same.
"use strict";
const D = JSON.parse("[" + Array.from({ length: 64 }, (_, i) => i * 3 % 17).join() + "]");
const P = D.map((x, i) => [x, i]);
function dist(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]); }
function f(t) { let s = 0; for (let i = 0; i < 64; i++) s += dist(P[i], P[(i + t) & 63]); return s & 65535; }
let sum = 0;
for (let t = 0; t < 300; t++) sum = (sum + f(t)) % 1000003;
console.log(sum);
