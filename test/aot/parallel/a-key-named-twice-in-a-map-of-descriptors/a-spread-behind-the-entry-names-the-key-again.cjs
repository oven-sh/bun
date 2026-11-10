"use strict";
const plus = (a, b) => a + b, minus = (a, b) => a - b;
const base = { join: { value: minus } };
function make() { return Object.defineProperties({}, { join: { value: plus }, ...base }); }
const turns = +(process.argv[2] ?? 6);
let s = 0;
for (let i = 0; i < turns; i++) s += make().join(5, i);
console.log(s);
