// STATISTIC: InvariantBasesGuardedAsArrays >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
let entered = 0;
class Below extends Array {}
Object.defineProperty(Below.prototype, 11, { get() { entered++; return { a: 9, b: q }; }, configurable: true });
const rows = process.argv.length > 99 ? JSON.parse(process.argv[99]) : Below.from(Array.from({ length: 64 }, (_, i) => ({ a: i, b: i / 2 })));
delete rows[11];
function worth(row) { return row.a * 2 + row.b; }
function f(t) { let s = t & 1; for (let i = 0; i < 64; i++) s += worth(rows[i]); return s; }
let sum = 0; for (let t = 0; t < 40; t++) sum = sum + f(t); console.log(sum, entered);
