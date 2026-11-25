"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const lib = { base: 1 }, other = { p1: 1 };
function lay(target) { Object.defineProperty(target, "add", { get() { return sub; } }); }
function layOwn() { Object.defineProperty(lib, "add", { get() { return add; } }); }
lay(other);
if (process.argv.length > 90) layOwn(); else lay(lib);
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
console.log(drive(+(process.argv[2] ?? 50)), other.add(9, 4));
