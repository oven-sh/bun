// STATISTIC: WalkLoopsVersioned >= 0
'use strict';
const q = Number(process.argv[2] ?? 3);
class Store { #rows = JSON.parse('[1.5,2.5,3.5,4.5,5.5,6.5]'); get rows() { return this.#rows; } set rows(v) { this.#rows = v; } }
const store = new Store();
function f(t) { let s = t & 1; for (let i = 0; i < store.rows.length; i++) { if (t === 30 && i === 2) store.rows = JSON.parse('[100.5,200.5,300.5,' + q + ']'); s = s + store.rows[i] * 2; } return s; }
const said = []; for (let t = 0; t < 40; t++) said.push(f(t)); console.log(said[0], said[29], said[30], said[31], said[39]);
