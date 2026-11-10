// STATISTIC: LoopsBuiltTwice >= 0
'use strict';
const q = Number(process.argv[2] ?? 3);
class Store { calls = 0; kinds = JSON.parse('[[1.5,2.5,3.5,4.5],{"0":7,"1":8,"length":2},"12' + q + '",[100.5]]'); get rows() { return this.kinds[this.calls++ % 4]; } }
const store = new Store();
function f(t) { let s = t & 1; for (let i = 0; i < store.rows.length; i++) s = s + store.rows[i] * 2; return s; }
const said = []; for (let t = 0; t < 12; t++) said.push(f(t)); console.log(said.join(), store.calls);
