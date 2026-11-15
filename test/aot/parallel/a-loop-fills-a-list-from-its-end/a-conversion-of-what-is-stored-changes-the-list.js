'use strict';
function f(t) { const a = []; const odd = { valueOf() { a.push(-7.5); return 0.25; } }; for (let i = 0; i < 20; i++) a[i] = (i === 6 ? odd : 0.5) * i + t; return a.length + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
