// STATISTIC: ArraysSpeculatedFromLocationUses >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
const D = JSON.parse('[0.5,2,-0,' + q + ',1e21,4.25]');
const seen = new Map([[2, 'two'], [3, 'three'], [0, 'zero']]);
function f(t) { let out = ''; for (let i = 0; i < D.length; i++) { const x = D[i]; out += (x === 2) + ',' + Object.is(x, -0) + ',' + seen.get(x) + ',' + (x | 0) + ',' + [10, 20, 30, 40][x] + ';'; } return out + t; }
let last = ''; for (let t = 0; t < 40; t++) last = f(t); console.log(last);
