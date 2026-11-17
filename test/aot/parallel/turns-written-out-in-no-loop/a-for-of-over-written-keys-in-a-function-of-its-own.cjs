"use strict";
function once(r) { let s = 0; for (const k of ["a", "b", "c", "d"]) s += r[k]; return s; }
const pick = [once, r => 0][JSON.parse("0")];
function f(t) { let s = t & 1; for (let i = 0; i < 64; i++) s += pick({ a: i, b: t & 7, c: 3, d: 4 }); return s; }
var n = Number(process.argv[2] || 300), sum = 0;
for (var t = 0; t < n; t++) sum = (sum + f(t)) % 1000003;
console.log(sum);
