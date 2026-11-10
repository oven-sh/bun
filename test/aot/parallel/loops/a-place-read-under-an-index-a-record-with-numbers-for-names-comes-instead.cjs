// STATISTIC: ArraysSpeculatedFromLocationUses >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
const D = JSON.parse('{"0":1.5,"1":2,"2":"x","3":' + q + ',"length":4}'); const seen = [];
function f(t) { seen.length = 0; for (let i = 0; i < D.length; i++) seen.push(D[i]); return seen.join() + t; }
let last; for (let t = 0; t < 40; t++) last = f(t); console.log(last);
