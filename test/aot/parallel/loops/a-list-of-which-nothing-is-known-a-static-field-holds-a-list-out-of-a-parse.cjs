// STATISTIC: WalkLoopsVersioned >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
class Table { static rows = JSON.parse('[' + Array.from({ length: 40 }, (_, i) => i + q + 0.5).join() + ']'); }
function f(t) { let s = t & 1; for (let i = 0; i < Table.rows.length; i++) s = s + Table.rows[i] * 2; return s; }
let sum = 0; for (let t = 0; t < 40; t++) sum = sum + f(t); console.log(sum);
