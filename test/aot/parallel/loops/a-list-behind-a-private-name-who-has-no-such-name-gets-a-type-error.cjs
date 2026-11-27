// STATISTIC: WalkLoopsVersioned >= 0
'use strict';
const q = Number(process.argv[2] ?? 3);
class Store { #rows = [1.5, 2.5, q]; get rows() { return this.#rows; } }
function f(o, t) { let s = t & 1; for (let i = 0; i < o.rows.length; i++) s = s + o.rows[i] * 2; return s; }
function tried(o, t) { try { return f(o, t); } catch (e) { return e instanceof TypeError ? 'TypeError' : 'other'; } }
const own = new Store(), below = Object.create(own), bare = Object.create(Store.prototype), plain = { rows: [q, 1] };
const said = []; for (let t = 0; t < 30; t++) tried(own, t);
for (const o of [own, below, bare, plain, own]) said.push(tried(o, 0)); console.log(said.join());
