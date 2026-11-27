'use strict';
function f(t) { const a = []; for (let i = 0; i < 20; i++) a[i] = i === 3 ? -0 : i === 4 ? 2 ** 53 + t : i === 5 ? -(2 ** 31) : i === 6 ? 2 ** 31 : i; return a.length + "|" + Object.is(a[3], -0) + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
