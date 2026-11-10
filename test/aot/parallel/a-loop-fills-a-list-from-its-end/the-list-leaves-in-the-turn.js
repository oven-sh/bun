'use strict';
const kept = []; function f(t) { const a = []; for (let i = 0; i < 20; i++) { a[i] = i * 0.5 + t; if (i === 5) kept[0] = a; if (i === 9) kept[0].length = 2; } return a.length + "|" + (5 in a) + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
