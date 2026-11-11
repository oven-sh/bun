// STATISTIC: WalkLoopsVersioned >= 0
'use strict';
const q = Number(process.argv[2] ?? 3);
let entered = 0;
class Counts extends Map { get(key) { entered++; return super.get(key); } }
const m = process.argv.length > 99 ? new Map() : new Counts(); m.set('rows', [1.5, 2.5, q]);
function f(t) { let s = t & 1; for (let i = 0; i < m.get('rows').length; i++) s = s + m.get('rows')[i] * 2; return s; }
let sum = 0; for (let t = 0; t < 40; t++) sum = sum + f(t); console.log(sum, entered);
