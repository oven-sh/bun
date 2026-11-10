"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const lib = { base: 3 };
const map = { add: { enumerable: true, get: function () { return this.base > 2 ? add : sub; } } };
Object.defineProperties(lib, map);
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
console.log(drive(+(process.argv[2] ?? 50)), map.add.get.call({ base: 1 })(9, 4));
