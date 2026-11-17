'use strict';
function more(a, i) { if (i === 7) a.push(-1.5, -2.5); } function f(t) { const a = [t + 0.5]; let s = 0; for (let i = 1; i < 30; i++) { a[i] = i * 0.5; more(a, i); s += a.length; } return s + "|" + a.length + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
