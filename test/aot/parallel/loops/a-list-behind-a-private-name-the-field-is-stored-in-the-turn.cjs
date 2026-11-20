// STATISTIC: WalkLoopsVersioned >= 0
'use strict';
const q = Number(process.argv[2] ?? 3);
class Store { #rows = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5]; get rows() { return this.#rows; } swap(i) { if (i === 3) this.#rows = [100.5, 200.5, 300.5, 400.5, 500.5, q]; } }
const store = new Store();
function f(t) { let s = t & 1; for (let i = 0; i < store.rows.length; i++) { if (t === 30) store.swap(i); s = s + store.rows[i] * 2; } return s; }
const said = []; for (let t = 0; t < 40; t++) said.push(f(t)); console.log(said[0], said[29], said[30], said[31], said[39]);
