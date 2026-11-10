"use strict";
const plus = (a, b) => a + b;
function make() { const map = { join: { value: plus }, size: { value: 2 } }; return [Object.defineProperties({}, map), Object.create(null, map)]; }
const turns = +(process.argv[2] ?? 6);
let s = 0;
for (let i = 0; i < turns; i++) { const [first, second] = make(); s += first.join(5, i) + second.join(i, second.size); }
console.log(s);
