"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const lib = { base: 1 };
const early = typeof lib.valueOf + " " + (lib.valueOf() === lib);
Object.defineProperty(lib, "valueOf", { get: function () { return function () { return 7; }; } });
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += lib.valueOf() + (lib + 1); return s; }
console.log(early, drive(+(process.argv[2] ?? 5)));
