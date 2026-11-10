// STATISTIC: ReadsThatAskTheirSitesBuiltInFrontOfLoops >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
function Store() {}
Store.rows = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, q];
function f(t) { let s = t & 1; for (let i = 0; i < Store.rows.length; i++) s = s + Store.rows[i] * 2; return s; }
let sum = 0; for (let t = 0; t < 40; t++) sum = sum + f(t); console.log(sum);
