'use strict';
function f(t) { const a = [], b = []; for (let i = 0; i < 40; i++) { a[i] = i * 0.5 + t; b[i] = i * 0.25; } return a.length + "|" + b.length + "|" + a.join() + "|" + b.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
