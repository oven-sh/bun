// STATISTIC: WalkLoopsVersioned >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
let entered = 0;
class Table { static rows = JSON.parse('[1.5,2.5,3.5]'); }
const odd = { at: -1, valueOf() { if (this.at === 0) Table.rows = [100.5, 200.5, 300.5, q]; if (this.at === 1) Table.rows.length = 2; if (this.at === 2) Table.rows = 'ab'; return 7; } };
function f(t) { let s = t & 1; for (let i = 0; i < Table.rows.length; i++) s = s + Table.rows[i] * 2; return s; }
function tried(t) { try { return f(t); } catch (e) { return e instanceof TypeError ? 'TypeError' : 'other'; } }
const said = []; for (let t = 0; t < 30; t++) tried(t);
for (const other of [new Float64Array([1.5, q]), '12', JSON.parse('{"0":1,"1":"7","length":2}'), new Proxy([1, q], { get(target, key, receiver) { entered++; return Reflect.get(target, key, receiver); } }), null, [1, , q], [1n]]) { Table.rows = other; let last; for (let t = 0; t < 4; t++) last = tried(t); said.push(last); }
for (let at = 0; at < 3; at++) { Table.rows = JSON.parse('[1.5,2.5,3.5,4.5]'); Table.rows[1] = odd; odd.at = at; said.push(tried(0)); odd.at = -1; said.push(tried(1)); }
console.log(said.join(), entered);
