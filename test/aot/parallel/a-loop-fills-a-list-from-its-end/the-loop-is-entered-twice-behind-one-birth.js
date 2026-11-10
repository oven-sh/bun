'use strict';
function fill(a, from, to, t) { for (let i = from; i < to; i++) a[i] = i * 0.5 + t; } function f(t) { const a = []; fill(a, 0, 10, t); fill(a, 10, 25, t); fill(a, 5, 8, -t); fill(a, 27, 30, t); return a.length + "|" + (26 in a) + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
