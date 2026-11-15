"use strict";
const plus = (a, b) => a + b;
function make(shown) { const descriptor = { value: plus }; if (shown) descriptor.enumerable = true; return Object.defineProperties({}, { join: descriptor }); }
const turns = +(process.argv[2] ?? 6);
let s = "";
for (let i = 0; i < turns; i++) { const made = make(i % 2 === 0); s += made.join(i, 1) + Object.keys(made).join() + ","; }
console.log(s);
