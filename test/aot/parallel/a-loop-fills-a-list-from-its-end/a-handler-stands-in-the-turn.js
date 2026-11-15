'use strict';
function risky(i) { if (i % 7 === 5) throw new Error("no"); return i * 0.5; } function f(t) { const a = []; let missed = 0; for (let i = 0; i < 30; i++) { try { a[i] = risky(i) + t; } catch { missed++; } } return missed + "|" + a.length + "|" + (5 in a) + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
