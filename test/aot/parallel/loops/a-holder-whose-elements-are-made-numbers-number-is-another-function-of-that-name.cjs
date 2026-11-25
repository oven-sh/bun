// STATISTIC: ArrayOrStringLoopsVersioned <= 0
'use strict';
const q = Number(process.argv[2] ?? 3);
const s = JSON.parse('"' + '1234567890'.repeat(6) + '"');
function sums(Number) { let c = 0; for (let i = 0; i < s.length; i++) c += Number(s[i]); return c; }
let calls = 0; const said = []; for (let t = 0; t < 30; t++) said.push(sums((x) => { calls++; return x.length + q; })); console.log(said[0], said[29], calls);
