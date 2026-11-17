"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const lib = { base: 1 };
Object.defineProperties(lib, { add: { configurable: process.argv.length > 0, get: function () { return add; } } });
function change() { Object.defineProperty(lib, "add", { get: function () { return sub; } }); }
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) { if (i === turns >> 1) change(); s = lib.add(s, i); } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
