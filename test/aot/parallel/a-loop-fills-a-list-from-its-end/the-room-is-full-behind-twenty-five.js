'use strict';
function f(t) { const cur = [t + 0.5]; for (let j = 1; j < 90; j++) cur[j] = cur[j - 1] + j * 0.5; return cur.length + "|" + cur[24] + "|" + cur[25] + "|" + cur[26] + "|" + cur[89]; }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
