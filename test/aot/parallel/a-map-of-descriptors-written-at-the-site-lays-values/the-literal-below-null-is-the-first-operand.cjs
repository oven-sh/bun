"use strict";
function add(a, b) { return (a + b) | 0; }
const names = Object.defineProperties({ __proto__: null }, { add: { value: add }, limit: { value: 1009, enumerable: true } });
const single = Object.defineProperty({ __proto__: null }, "add", { value: add });
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = single.add(names.add(s, i), 1) % names.limit; return s; }
console.log(drive(+(process.argv[2] ?? 50)), Object.keys(names).join(), Object.getPrototypeOf(names), Object.getOwnPropertyNames(single).join());
