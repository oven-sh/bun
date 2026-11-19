"use strict";
function h(...l) { let s = 0; for (let i = l.length - 1; i >= 0; i--) s += l[i]; return s; }
function f(t) { let s = t & 1; const x = t; for (let i = 0; i < 64; i++) s += h(i, x & 7, 3); return s; }
var n = Number(process.argv[2] || 300), sum = 0;
for (var t = 0; t < n; t++) sum = (sum + f(t)) % 1000003;
console.log(sum);
