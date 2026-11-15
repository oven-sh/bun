// STATISTIC: StaticFieldGuardsHoisted >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
function tried(h) { try { return h(); } catch (e) { return e instanceof TypeError ? 'TypeError' : e instanceof ReferenceError ? 'ReferenceError' : 'other'; } }
const early = tried(() => Store.sum());
class Store { static sum() { let s = 0; for (let i = 0; i < Store.rows.length; i++) s = s + Store.rows[i] * 2; return s; } static first = tried(() => Store.sum()); static rows = [1.5, 2.5, q]; static second = tried(() => Store.sum()); }
let last; for (let t = 0; t < 40; t++) last = Store.sum(); console.log(early, Store.first, Store.second, last);
