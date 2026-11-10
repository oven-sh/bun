// STATISTIC: LoopsBuiltTwice >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
class Box { #rows = JSON.parse('[1,2.5,' + q + ']'); sum() { let s = 0; for (let i = 0; i < this.#rows.length; i++) s = s + this.#rows[i] * 2; return s; } }
class Other { #rows = JSON.parse('[100]'); }
const receivers = [new Box(), {}, new Other(), Object.create(new Box()), null];
let last; for (let t = 0; t < 40; t++) last = receivers.map(receiver => { try { return Box.prototype.sum.call(receiver); } catch (e) { return e instanceof TypeError ? 'TypeError' : 'other'; } }).join(); console.log(last);
