'use strict';
function g(a, n) { for (let i = 0; i < n; i++) a[i] = i * 0.5; return a.length; } function f(t) { const a = []; let s = ""; for (const n of [1, 5, 6, 9, 10, 16, 40, 41, 200, 1000]) s += g(a, n + (t & 1)) + ","; return s + a[999] + "|" + a.length; }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
