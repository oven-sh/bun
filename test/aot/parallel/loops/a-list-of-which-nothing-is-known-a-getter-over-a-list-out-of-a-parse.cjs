// STATISTIC: WalkLoopsVersioned >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
class Store { _rows = JSON.parse('[' + Array.from({ length: 40 }, (_, i) => i + q + 0.5).join() + ']'); get rows() { return this._rows; } sum(t) { let s = t & 1; for (let i = 0; i < this.rows.length; i++) s = s + this.rows[i] * 2; return s; } }
const store = new Store();
let sum = 0; for (let t = 0; t < 40; t++) sum = sum + store.sum(t); console.log(sum);
