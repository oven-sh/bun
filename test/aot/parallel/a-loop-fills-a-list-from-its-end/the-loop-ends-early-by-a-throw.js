'use strict';
function h(i) { if (i === 17) throw new RangeError("seventeen"); return i * 0.5; } function f(t) { const a = []; let said = ""; try { for (let i = 0; i < 40; i++) a[i] = h(i) + t; } catch (e) { said = e.message; } return said + "|" + a.length + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
