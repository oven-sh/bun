'use strict';
function f(t) { const a = []; for (let i = 0; i < 30; i++) { if (i % 5 === 3) continue; a[i] = i * 0.5 + t; } return a.length + "|" + (3 in a) + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
