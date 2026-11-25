'use strict';
function g(a, b, t) { let s = 0; for (let i = 0; i < 40; i++) { a[i] = i * 0.5 + t; s += b.length + (b[i] === a[i] ? 1000 : 0); } return s; } function f(t) { const a = []; return g(a, a, t) + "|" + g([], [0.5], t); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
