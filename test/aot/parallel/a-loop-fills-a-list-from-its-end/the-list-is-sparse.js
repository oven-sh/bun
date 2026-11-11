'use strict';
function g(a, t) { for (let i = 0; i < 20; i++) a[i] = i * 0.5 + t; return a.length + "|" + a[100000] + "|" + a[19]; } function f(t) { const a = []; a[100000] = 7.5; return g([], t) + "/" + g(a, t); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
