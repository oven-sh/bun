"use strict";
const a = [1, 2, 3, 4, 5, 6, 7, 8], b = [8, 7, 6, 5, 4, 3, 2, 1];
function f(t) { let s = t & 1; for (let k = 0; k < 64; k++) { a[k & 7] = t & 15; for (let i = 0; i < 8; i++) s += a[i] * b[i]; } return s; }
var n = Number(process.argv[2] || 300), sum = 0;
for (var t = 0; t < n; t++) sum = (sum + f(t)) % 1000003;
console.log(sum);
