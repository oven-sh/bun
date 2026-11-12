'use strict';
function over(a, t) { for (let i = 0; i < 8; i++) a[i] = -i * 0.5 - t; return a.length; } function f(t) { const a = []; for (let i = 0; i < 20; i++) a[i] = i * 0.5 + t; const l = over(a, t); return l + "|" + a.length + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
