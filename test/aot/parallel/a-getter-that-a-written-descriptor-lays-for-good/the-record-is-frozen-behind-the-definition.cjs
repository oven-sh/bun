"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const lib = { base: 1 };
Object.defineProperty(lib, "add", { enumerable: true, get: function () { return add; } });
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
const early = drive(+(process.argv[2] ?? 50));
Object.freeze(lib);
function store() { try { lib.base = 2; return "stored"; } catch (error) { return error.constructor.name; } }
console.log(early, drive(+(process.argv[2] ?? 50)), store(), lib.base);
