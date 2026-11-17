"use strict";
const order = [];
function note(what, value) { order.push(what); return value; }
const names = Object.create(note("parent", null), { first: { value: note("first", 1), enumerable: note("flag of first", true) }, second: { value: note("second", 2) } });
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += names.first + names.second; return s; }
console.log(drive(+(process.argv[2] ?? 50)), order.join(), Object.keys(names).join());
