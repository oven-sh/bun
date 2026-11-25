"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const lib = {};
const o1 = { p1: 1 }, o2 = { p2: 1 }, o3 = { p3: 1 }, o4 = { p4: 1 }, o5 = { p5: 1 };
function fill(target) { target.mark = sub; }
fill(o1); fill(o2); fill(o3); fill(o4); fill(o5); fill(lib);
Object.defineProperty(lib, "add", { get() { return add; } });
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
console.log(drive(+(process.argv[2] ?? 50)), lib.mark(9, 4), o3.mark(9, 4));
