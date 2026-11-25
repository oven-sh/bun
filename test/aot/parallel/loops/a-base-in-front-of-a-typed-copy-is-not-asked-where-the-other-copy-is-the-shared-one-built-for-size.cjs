// STATISTIC: InvariantBasesGuardedAsArrays <= 0
'use strict';
const q = Number(process.argv[2] ?? 3);
const record = JSON.parse('{' + Array.from({ length: 64 }, (_, i) => '"' + i + '":' + (i % 5 ? i + 0.5 : 0)).join() + ',"length":64,"size":' + q + '}');
function zeros(t) { let c = t & 1; for (let i = 0; i < 64; i++) if (record[i] === 0) c = c + 1; return c; }
let all = 0; for (let t = 0; t < 40; t++) all += zeros(t); console.log(all);
