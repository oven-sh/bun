// STATISTIC: BasesInFrontOfTypedCopiesAskedForLists >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
const rows = JSON.parse('[' + Array.from({ length: 64 }, (_, i) => '{"a":' + i + ',"b":' + (i / 2) + '}').join() + ']');
const odd = { at: -1, valueOf() { if (this.at === 0) rows.length = 20; if (this.at === 1) rows[30] = { a: 100000, b: q }; if (this.at === 2) Object.defineProperty(rows, 40, { get() { return { a: 1000000, b: q }; }, configurable: true }); if (this.at === 3) { delete rows[50]; Object.setPrototypeOf(rows, { 50: { a: 50000000, b: q } }); } return 7; } };
function worth(row) { return row === undefined ? -1 : row.a * 2 + row.b; }
function f(t) { let s = t & 1; for (let i = 0; i < 64; i++) s += worth(rows[i]); return s; }
const said = []; for (let t = 0; t < 30; t++) f(t);
said.push(f(0)); rows[10].a = odd;
for (let at = 0; at < 4; at++) { odd.at = at; said.push(f(0)); odd.at = -1; said.push(f(1)); if (at === 0) { for (let i = 20; i < 64; i++) rows.push({ a: i, b: i / 2 }); } }
console.log(said.join());
