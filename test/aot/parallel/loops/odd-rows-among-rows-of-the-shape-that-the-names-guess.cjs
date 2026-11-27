// One loop over lists whose rows are of the shape that the names guess, of another shape with the same names, or odd: a getter that counts, a name that is missing, a text for a number, a row above another object,
// a frozen row, a hole, and a null that throws in the middle of the list. The typed copy is left at the first odd row and the other copy goes on from that turn: nothing runs twice, nothing is skipped.
'use strict';
const WRITTEN = Array.from({ length: 12 }, (_, i) => ({ id: i, name: 'item' + i, weight: (i * 7) % 5 + 0.5, kind: i % 3 }));
const parse = text => JSON.parse(text), parsed = () => parse(JSON.stringify(WRITTEN));
let asked = 0;
const withGetter = at => { const rows = WRITTEN.slice(); const row = parse('{"id":3,"name":"g","kind":1}'); Object.defineProperty(row, 'weight', { get() { asked++; return 2.5; }, enumerable: true }); rows[at] = row; return rows; };
const withRow = (at, text) => { const rows = WRITTEN.slice(); rows[at] = parse(text); return rows; };
const above = at => { const rows = WRITTEN.slice(); rows[at] = Object.create(WRITTEN[2]); return rows; };
const frozen = at => { const rows = WRITTEN.slice(); rows[at] = Object.freeze(parsed()[at]); return rows; };
const holed = at => { const rows = WRITTEN.slice(); delete rows[at]; return rows; };
const a = x => { x = x / 2 + 1; return x * x; }, b = x => { x = x + 1; if (x > 50) x = 50; return -(Math.round(x * 10) / 10); };
function f(rows, t) { let s = 0; for (const row of rows) { const k = (row.kind + t) % 3, x = row.weight + row.id; s += k === 0 ? a(x) : b(x); } return typeof s === 'number' ? Math.round(s * 100) / 100 : s; }
const tried = (rows, t) => { try { return f(rows, t); } catch (error) { return error.constructor.name; } };
const lists = [WRITTEN, parsed(), withGetter(0), withGetter(5), withGetter(11), withRow(4, '{"id":4,"name":"n","kind":2}'), withRow(6, '{"id":"6","name":"t","weight":"1.5","kind":0}'), withRow(7, '{"kind":1,"weight":1,"name":"o","id":7,"more":true}'), above(3), frozen(8), holed(9), withRow(10, 'null'), WRITTEN.map((row, i) => i & 1 ? row : parsed()[i])];
const n = +(process.argv[2] ?? 40);
for (let t = 0; t < n; t++) { const said = lists.map(rows => tried(rows, t)).join(' | '); if (t < 3 || t === n - 1) console.log(said, asked); }
