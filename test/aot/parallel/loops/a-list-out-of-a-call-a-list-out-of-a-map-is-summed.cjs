// STATISTIC: LoopsBuiltTwice >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
const m = new Map(); const made = []; for (let i = 0; i < 40; i++) made.push(i + q + 0.5); m.set('rows', made);
function f(t) { let s = t & 1; for (let i = 0; i < m.get('rows').length; i++) s = s + m.get('rows')[i] * 2; return s; }
let sum = 0; for (let t = 0; t < 40; t++) sum = sum + f(t); console.log(sum);
