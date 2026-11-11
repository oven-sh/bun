// STATISTIC: SiteCachedReadsHoisted >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
function make(k) { function Store() {} Store.rows = [k + 0.5, k + 1.5, q]; Store.sum = function () { let s = 0; for (let i = 0; i < Store.rows.length; i++) s = s + Store.rows[i] * 2; return s; }; return Store; }
const made = [make(1), make(10)]; let last; for (let t = 0; t < 40; t++) last = made.map(one => one.sum()).join(); console.log(last);
