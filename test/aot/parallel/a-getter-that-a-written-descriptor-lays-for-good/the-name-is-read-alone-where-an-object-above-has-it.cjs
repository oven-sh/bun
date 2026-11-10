"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const lib = { base: 1 };
function above(target) { Object.setPrototypeOf(target, { size: "above" }); }
above(lib);
function read(turns) { let s = ""; for (let i = 0; i < turns; i++) s += lib.size; return s; }
const early = read(2);
Object.defineProperty(lib, "size", { get() { return 7; } });
console.log(early, read(2));
