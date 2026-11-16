// A row that lacks a field, added in forEach(), where a push stands between the two reads of the row.
class A { constructor(a, b) { this.a = a; this.b = b; } }
class C {}
const log = [], other = {};
function f(rows) { let s = 0; rows.forEach(p => { const x = p.c; log.push(p); s = p.a + x; }); return s; }
const make = i => i % 3 === 1 ? new C() : i % 3 === 2 ? { a: i, b: 4 } : new A(i, 2), list = n => { const l = []; for (let i = 0; i < n; i++) l.push(make(i)); l.push(new A("1", 1)); return l; };
for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18, 24, 31, 32, 33, 40, 64, 100, 400, 4000]) console.log("rows", n, f(list(n)));
for (let c = 1; c <= 4000; c++) { const s = f(list(c % 20)); if (c === 4 || c === 8 || c === 11 || c === 17 || c === 40 || c === 400 || c === 4000) console.log("call", c, s); }
