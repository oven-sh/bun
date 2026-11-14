"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const inner = { add };
const lib = {};
Object.defineProperty(lib, "__esModule", { value: true });
lib.add = void 0;
Object.defineProperty(lib, "add", { enumerable: true, get: function () { return inner.add; } });
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
function again() { Object.defineProperty(lib, "add", { enumerable: true, get: function () { return sub; } }); }
const early = drive(+(process.argv[2] ?? 50));
again();
console.log(early, drive(+(process.argv[2] ?? 50)));
