"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const lib = { base: 1 };
const o1 = { p1: 1 }, o2 = { p2: 1 }, o3 = { p3: 1 }, o4 = { p4: 1 }, o5 = { p5: 1 };
function lay(target) { Object.defineProperty(target, "add", { get() { return sub; } }); }
function layOwn() { Object.defineProperty(lib, "add", { get() { return add; } }); }
lay(o1); lay(o2); lay(o3); lay(o4); lay(o5);
if (process.argv.length > 90) layOwn(); else lay(lib);
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
console.log(drive(+(process.argv[2] ?? 50)), o3.add(9, 4));
