"use strict";
const names = {};
Object.preventExtensions(names);
function attempt() { try { Object.defineProperty(names, "add", { get() { return 1; } }); return "defined"; } catch (error) { return error.constructor.name; } }
function drive(turns) { let s = ""; for (let i = 0; i < turns; i++) s += typeof names.add; return s.length; }
console.log(attempt(), drive(+(process.argv[2] ?? 50)));
