// STATISTIC: LoopsBuiltForListsAndForTexts >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
const s = JSON.parse('"' + '1234567890'.repeat(6) + q + '"');
function f(t) { let c = t & 1; for (let i = 0; i < s.length; i++) c += Number(s[i]); return c; }
let sum = 0; for (let t = 0; t < 40; t++) sum = sum + f(t); console.log(sum);
