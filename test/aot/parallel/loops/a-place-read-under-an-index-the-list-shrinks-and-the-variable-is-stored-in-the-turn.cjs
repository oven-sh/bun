// STATISTIC: ArraysSpeculatedFromLocationUses >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
const L = JSON.parse('[1,2,3,4,5,6]'); var rows = JSON.parse('[1,2,3]'); const other = JSON.parse('{"0":"a","1":"b","2":"c","3":"d","length":4}'), cut = JSON.parse('"cut"'), swap = JSON.parse('"swap"');
const T = { cut(x) { if (x === q) L.length = 4; return x; }, swap(x) { if (x === 2) rows = other; return x; } };
function f(t) { let s = t; for (let i = 0; i < L.length; i++) s = s + T[cut](L[i]); return s; }
function g(t) { let s = '' + t; for (let i = 0; i < rows.length; i++) s = s + T[swap](rows[i]); return s; }
console.log(f(0), L.length, f(1), g(0), g(1));
