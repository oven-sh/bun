'use strict';
function* g(a, t) { for (let i = 0; i < 12; i++) { a[i] = i * 0.5 + t; yield a.length; } } function f(t) { const a = []; let s = ""; for (const l of g(a, t)) { s += l + ","; if (l === 5) a.length = 2; if (l === 8) a.push(-1.5); } return s + "|" + a.length + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
