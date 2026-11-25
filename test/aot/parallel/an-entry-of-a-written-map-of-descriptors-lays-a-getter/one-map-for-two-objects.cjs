"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const map = { add: { enumerable: true, get: function () { return this.base > 2 ? add : sub; } } };
const lib = { base: 3 }, other = { base: 1, more: 2 };
Object.defineProperties(lib, map);
Object.defineProperties(other, map);
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
console.log(drive(+(process.argv[2] ?? 50)), other.add(9, 4));
