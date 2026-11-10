// STATISTIC: StaticFieldGuardsHoisted >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
class Store { static rows = []; static weights = [2.5, 3.5, q]; }
function f(t) { let s = t & 1; for (let i = 0; i < Store.rows.length; i++) { if (i & 1) s = s + Store.weights[i % 3]; s = s + Store.rows[i]; } return s; }
function tried(t) { try { return f(t); } catch (e) { return e instanceof TypeError ? 'TypeError' : 'other'; } }
function strike(holder, name) { delete holder[name]; }
const said = []; for (let t = 0; t < 40; t++) { said.push(tried(t)); if (t === 20) Store.rows.push(1.5, 2.5, 3.5, 4.5); if (t === 30) strike(Store, 'weigh' + (q === 3 ? 'ts' : 't')); } console.log(said[0], said[20], said[21], said[31], said[39]);
