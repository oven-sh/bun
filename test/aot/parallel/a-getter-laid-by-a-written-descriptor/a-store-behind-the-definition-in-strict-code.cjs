"use strict";
function store(names, value) { try { names.add = value; return 1000; } catch (error) { return error instanceof TypeError ? names.add : -1; } }
const names = {};
Object.defineProperty(names, "add", { get() { return 7; } });
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += store(names, i); return s; }
console.log(drive(+(process.argv[2] ?? 50)), names.add);
