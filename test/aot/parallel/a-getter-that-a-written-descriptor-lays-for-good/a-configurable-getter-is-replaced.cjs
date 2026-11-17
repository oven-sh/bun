"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const lib = {};
Object.defineProperty(lib, "add", { configurable: true, get: function () { return add; } });
function change() { Object.defineProperty(lib, "add", { configurable: true, get: function () { return sub; } }); }
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) { if (i === turns >> 1) change(); s = lib.add(s, i); } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
