// STATISTIC: LoopsBuiltTwice >= 0
'use strict';
const q = Number(process.argv[2] ?? 3);
class Store { calls = 0; first = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5]; second = [100.5, 200.5, 300.5, q]; rows() { return ++this.calls % 7 === 0 ? this.second : this.first; } }
const store = new Store();
function f(t) { let s = t & 1; for (let i = 0; i < store.rows().length; i++) s = s + store.rows()[i] * 2; return s; }
const said = []; for (let t = 0; t < 12; t++) said.push(f(t)); console.log(said.join());
