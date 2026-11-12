"use strict";
function add(a, b) { return (a + b) | 0; }
const lib = {};
Object.defineProperty(lib, "add", { enumerable: true, get: function () { return add; } });
function attempt(what) { try { what(); return "done"; } catch (error) { return error.constructor.name; } }
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
console.log(attempt(() => { delete lib.add; }), attempt(() => { lib.add = 5; }), attempt(() => { Object.defineProperty(lib, "add", { value: 5 }); }), drive(+(process.argv[2] ?? 50)));
