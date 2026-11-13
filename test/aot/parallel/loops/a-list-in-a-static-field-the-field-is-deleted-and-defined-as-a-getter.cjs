// STATISTIC: StaticFieldGuardsHoisted >= 0
'use strict';
const q = Number(process.argv[2] ?? 3);
class Store { static rows = [1.5, 2.5, 3.5, q]; }
function f(t) { let s = t & 1; for (let i = 0; i < Store.rows.length; i++) s = s + Store.rows[i] * 2; return s; }
function tried(t) { try { return f(t); } catch (e) { return e instanceof TypeError ? 'TypeError' : 'other'; } }
function strike(holder, name) { delete holder[name]; }
function lay(holder, name, descriptor) { Object.defineProperty(holder, name, descriptor); }
const said = []; let entered = 0; const name = 'ro' + (q === 3 ? 'ws' : 'w');
for (let t = 0; t < 40; t++) { if (t === 20) strike(Store, name); if (t === 30) lay(Store, name, { configurable: true, get() { entered++; return [100.5, q]; } }); said.push(tried(t)); }
console.log(said[0], said[19], said[20], said[29], said[30], said[39], entered);
