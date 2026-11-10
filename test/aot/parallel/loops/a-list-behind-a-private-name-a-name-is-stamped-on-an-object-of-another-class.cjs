// STATISTIC: LoopsBuiltTwice >= 0
'use strict';
const q = Number(process.argv[2] ?? 3);
class Hands { constructor(o) { return o; } }
class Stamp extends Hands { #rows = [1.5, 2.5, q]; static rowsOf(o) { return o.#rows; } static has(o) { return #rows in o; } }
function f(o, t) { let s = t & 1; for (let i = 0; i < Stamp.rowsOf(o).length; i++) s = s + Stamp.rowsOf(o)[i] * 2; return s; }
function tried(o, t) { try { return f(o, t); } catch (e) { return e instanceof TypeError ? 'TypeError' : 'other'; } }
const record = { a: 1 }, list = [7], other = { a: 2 };
new Stamp(record); new Stamp(list);
const said = []; for (let t = 0; t < 30; t++) tried(record, t);
for (const o of [record, list, other]) said.push(tried(o, 0), Stamp.has(o)); console.log(said.join());
