'use strict';
function f(t) { const a = []; for (let i = 0; i < 30; i++) { a[i] = i * 0.5 + t; if (i === 10) i++; } return a.length + "|" + (11 in a) + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
