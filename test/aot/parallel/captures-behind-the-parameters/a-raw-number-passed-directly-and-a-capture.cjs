"use strict";
function make(a) { function g(x, y) { let s = x * .5 + a; for (let j = 0; j < y; j++) s += j; return s | 0; } return g; }
const g = make(3);
function f(t) { let r = t & 1; for (let i = 0; i < 64; i++) r = (r + g(i, 2)) & 1023; return r; }
var n = Number(process.argv[2] || 300), sum = 0;
for (var t = 0; t < n; t++) sum = (sum + f(t)) % 1000003;
console.log(sum);
