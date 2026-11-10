// STATISTIC: LoopsBuiltTwice >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
let rows = [];
function load() { rows = JSON.parse('[1,2,3,4,5,6]'); }
load();
const odd = { at: -1, valueOf() { if (this.at === 0) rows.length = 3; if (this.at === 1) rows[4] = 'x' + q; if (this.at === 2) rows = [100.5]; return 7; } };
function f(t) { let s = t & 1; for (let i = 0; i < rows.length; i++) s = s + rows[i] * 2; return s; }
const said = [f(0)]; for (let at = 0; at < 3; at++) { load(); rows[1] = odd; odd.at = at; said.push(f(0)); odd.at = -1; said.push(f(1)); } console.log(said.join());
