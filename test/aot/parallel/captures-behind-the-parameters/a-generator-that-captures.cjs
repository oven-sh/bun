"use strict";
const w = JSON.parse('0');
function make(a, b) { return function* (p, q, r, x, y) { yield p + a; yield q + b; yield r + x + y; }; }
const g = make(1, 2);
function f(t) { let s = t & 1; for (let i = 0; i < 8; i++) for (const v of g(i, t, 1, 2, 3)) s = (s + v) & 1023; return s; }
var n = Number(process.argv[2] || 300), sum = 0;
for (var t = 0; t < n; t++) sum = (sum + f(t)) % 1000003;
console.log(sum);
