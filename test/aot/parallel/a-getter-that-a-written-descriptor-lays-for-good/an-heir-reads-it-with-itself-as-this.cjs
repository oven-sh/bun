"use strict";
const lib = { base: 2 };
Object.defineProperty(lib, "twice", { get() { return this.base * 2; } });
const heir = Object.create(lib);
heir.base = 10;
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += lib.twice + heir.twice; return s; }
console.log(drive(+(process.argv[2] ?? 6)));
