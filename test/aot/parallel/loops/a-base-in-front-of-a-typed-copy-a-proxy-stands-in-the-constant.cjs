// STATISTIC: BasesInFrontOfTypedCopiesAskedForLists >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
let entered = 0;
const rows = process.argv.length > 99 ? JSON.parse(process.argv[99]) : new Proxy(Array.from({ length: 64 }, (_, i) => ({ a: i, b: i / 2 + q })), { get(target, key, receiver) { entered++; return Reflect.get(target, key, receiver); } });
function worth(row) { return row.a * 2 + row.b; }
function f(t) { let s = t & 1; for (let i = 0; i < 64; i++) s += worth(rows[i]); return s; }
let sum = 0; for (let t = 0; t < 40; t++) sum = sum + f(t); console.log(sum, entered);
