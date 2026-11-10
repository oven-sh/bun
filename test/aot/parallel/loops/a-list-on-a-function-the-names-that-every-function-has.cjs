// STATISTIC: ReadsThatAskTheirSitesBuiltInFrontOfLoops >= 0
'use strict';
const q = Number(process.argv[2] ?? 3);
function Store(a, b, c) {}
Store.prototype.rows = [1.5, q];
function letters(t) { let s = ''; for (let i = 0; i < Store.name.length; i++) s = s + Store.name[i] + (t & 1); return s; }
function above(t) { let s = t & 1; for (let i = 0; i < Store.prototype.rows.length; i++) s = s + Store.prototype.rows[i] * 2; return s; }
function counted(t) { let s = t & 1; for (let i = 0; i < Store.length; i++) s = s + i; return s; }
let last; for (let t = 0; t < 40; t++) { if (t === 30) Object.defineProperty(Store, 'name', { value: 'Kept' + q }); last = [letters(t), above(t), counted(t)].join(); } console.log(last);
