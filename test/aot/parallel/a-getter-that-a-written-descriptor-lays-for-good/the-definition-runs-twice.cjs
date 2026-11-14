"use strict";
function add(a, b) { return (a + b) | 0; }
const lib = {};
function lay() { try { Object.defineProperty(lib, "add", { enumerable: true, get: function () { return add; } }); return "laid"; } catch (error) { return error.constructor.name; } }
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
console.log(lay(), lay(), drive(+(process.argv[2] ?? 50)));
