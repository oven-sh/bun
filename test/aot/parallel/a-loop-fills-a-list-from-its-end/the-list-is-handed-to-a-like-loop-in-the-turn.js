'use strict';
function over(a, m) { for (let i = 0; i < m; i++) a[i] = -i * 0.5; return a.length; } function f(t) { const a = []; let s = 0; for (let i = 0; i < 20; i++) { a[i] = i * 0.5 + t; if (i === 6) s += over(a, 3); if (i === 9) s += over(a, 14); } return s + "|" + a.length + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
