"use strict";
function once(a, b) { let s = 0; for (let i = 0; i < 8; i++) s += a[i] * b[i]; return s; }
const pick = [once, (a, b) => 0][JSON.parse("0")];
const a = [1, 2, 3, 4, 5, 6, 7, 8], b = [8, 7, 6, 5, 4, 3, 2, 1];
function f(t) { let s = t & 1; for (let i = 0; i < 64; i++) { a[i & 7] = t & 15; s += pick(a, b); } return s; }
var n = Number(process.argv[2] || 300), sum = 0;
for (var t = 0; t < n; t++) sum = (sum + f(t)) % 1000003;
console.log(sum);
