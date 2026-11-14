// A helper that is copied in line is handed the element of the turn, of which nothing is known, and reads one field of it. The read has a test that may fail, and a turn begins again where it does,
// but no way through the copy comes to an operation that stays as it is written: what the helper hands back is asked for a number, and the sum stays typed. One element holds a text.
// STATISTIC: MapResultsGuardedAsNumbers >= 1
"use strict";
class A { constructor(d) { this.v = d.v; } }
const rows = JSON.parse(JSON.stringify(Array.from({ length: 24 }, (_, i) => ({ v: i === 17 ? "7" : i % 5 + 1 }))));
const classes = new Map([[0, A]]);
const all = rows.map(d => new (classes.get(0))(d));
function read(s) { return s.v; }
function f(t) { let s = t & 1; for (const x of all) s += read(x); return s; }
let sum = 0; for (let t = 0; t < 300; t++) sum += f(t).length; console.log(sum, f(1));
