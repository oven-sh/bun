// STATISTIC: IndexedStoresCompiledAsAppends >= 1
'use strict';
function g(a, b, t) { let s = 0; for (let i = 1; i < 30; i++) { s = s * 2 % 1000003 + b.length; a[i] = i * 0.5 + t; } return s; } function f(t) { const a = [t + 0.5]; let s = 0; for (let i = 1; i < 30; i++) { const b = i & 1 ? a : [1.5]; s = s * 2 % 1000003 + b.length; a[i] = i * 0.5; } return s + "|" + g([0.5], [1.5], t) + "|" + a.length; }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
