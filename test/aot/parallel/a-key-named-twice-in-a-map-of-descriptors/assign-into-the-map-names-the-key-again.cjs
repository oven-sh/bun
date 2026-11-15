"use strict";
const plus = (a, b) => a + b, minus = (a, b) => a - b;
const base = { join: { value: minus } };
function make() { const map = { join: { value: plus } }; Object.assign(map, base); return Object.defineProperties({}, map); }
const turns = +(process.argv[2] ?? 6);
let s = 0;
for (let i = 0; i < turns; i++) s += make().join(5, i);
console.log(s);
