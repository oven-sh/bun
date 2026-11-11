'use strict';
function f(t) { const a = []; for (let i = 0; i < 300000; i++) a[i] = i * 0.5 + t; return a.length + "|" + a[299999] + "|" + a[150000]; }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
