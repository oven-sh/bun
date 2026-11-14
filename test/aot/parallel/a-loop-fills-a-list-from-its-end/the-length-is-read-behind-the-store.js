// STATISTIC: StoresGrowingArrays >= 1
'use strict';
function f(t) { const a = [t + 0.5]; let s = 0; for (let i = 1; i < 30; i++) { a[i] = i * 0.5; s = s * 2 % 1000003 + a.length; } return s + "|" + a.length + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
