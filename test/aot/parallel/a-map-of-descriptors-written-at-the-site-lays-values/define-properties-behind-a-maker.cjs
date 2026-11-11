"use strict";
function add(a, b) { return (a + b) | 0; }
const names = { __proto__: null };
Object.defineProperties(names, { add: { value: add }, limit: { value: 1009, enumerable: true } });
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = names.add(s, i) % names.limit; return s; }
console.log(drive(+(process.argv[2] ?? 50)), Object.keys(names).join());
