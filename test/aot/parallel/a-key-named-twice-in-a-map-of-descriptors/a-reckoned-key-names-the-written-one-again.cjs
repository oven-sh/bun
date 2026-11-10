"use strict";
const plus = (a, b) => a + b, minus = (a, b) => a - b;
const key = JSON.parse('"join"');
function make() { return Object.defineProperties({}, { join: { value: plus }, [key]: { value: minus } }); }
const turns = +(process.argv[2] ?? 6);
let s = 0;
for (let i = 0; i < turns; i++) s += make().join(5, i);
console.log(s);
