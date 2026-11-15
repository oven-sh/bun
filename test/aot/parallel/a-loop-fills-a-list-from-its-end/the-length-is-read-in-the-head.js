'use strict';
function f(t) { const a = [t + 0.5]; let turns = 0; for (let i = 1; i < 60; i++) { if (a.length > 30) break; a[i] = i * 0.5; turns++; } return turns + "|" + a.length; }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
