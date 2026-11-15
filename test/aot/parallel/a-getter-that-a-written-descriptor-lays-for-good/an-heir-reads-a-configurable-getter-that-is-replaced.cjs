"use strict";
const lib = { base: 2 };
Object.defineProperty(lib, "twice", { configurable: true, get() { return this.base * 2; } });
const heir = Object.create(lib);
heir.base = 10;
function read(turns) { let s = 0; for (let i = 0; i < turns; i++) s += heir.twice | 0; return s; }
const early = read(+(process.argv[2] ?? 3));
Object.defineProperty(lib, "twice", { configurable: true, get() { return this.base * 3; } });
console.log(early, read(+(process.argv[2] ?? 3)), lib.twice);
