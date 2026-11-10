// STATISTIC: StaticFieldsAskedInFrontOfLoops >= 0
'use strict';
const q = Number(process.argv[2] ?? 3);
class Store { static rows = [1.5, 2.5, 3.5, 4.5]; static other = [10.5, 20.5, 30.5, 40.5, q]; }
function f(t) { let s = t & 1; for (let i = 0; i < Store.rows.length; i++) { s = s + Store.rows[i] * 2; if (t === 30 && i === 1) Store.rows = Store.other; } return s; }
const said = []; for (let t = 0; t < 40; t++) said.push(f(t)); console.log(said[0], said[30], said[31], said[39]);
