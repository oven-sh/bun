// STATISTIC: WalkLoopsVersioned >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
const shelf = new Map([['rows', JSON.parse('[' + Array.from({ length: 40 }, (_, i) => (i * 7 + q) % 31 + 1).join() + ']')]]);
function f(t) { let s = t & 1; for (let i = 0; i < shelf.get('rows').length; i++) s = s + shelf.get('rows')[i]; return s; }
let sum = 0; for (let t = 0; t < 40; t++) sum = sum + f(t); console.log(sum);
