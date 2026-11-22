'use strict';
async function g(t) { const a = []; const other = Promise.resolve().then(() => { a.push(-3.5); }); for (let i = 0; i < 12; i++) { a[i] = i * 0.5 + t; if (i === 4) await other; } return a.length + "|" + a.join(); } let last = ""; function f(t) { g(t).then(v => { last = v; console.log(v); }); return ""; }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
