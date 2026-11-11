// STATISTIC: WalkLoopsVersioned >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
function fresh() { exports.rows = JSON.parse('[1.5,2.5,3.5,4.5,5.5,6.5]'); }
fresh();
const odd = { at: -1, valueOf() { if (this.at === 0) exports.rows = [100.5, 200.5, 300.5]; if (this.at === 1) exports.rows.length = 3; if (this.at === 2) exports.rows = 'ab' + q; if (this.at === 3) exports.rows[4] = 'x'; return 7; } };
function f(t) { let s = t & 1; for (let i = 0; i < exports.rows.length; i++) s = s + exports.rows[i] * 2; return s; }
const said = []; for (let t = 0; t < 30; t++) f(t);
for (let at = 0; at < 4; at++) { fresh(); exports.rows[1] = odd; odd.at = at; said.push(f(0)); odd.at = -1; said.push(f(1)); } console.log(said.join());
