"use strict";
const names = {};
Object.defineProperty(names, "add", { get() { return 1; } });
function attempt(act) { try { return String(act()); } catch (error) { return error.constructor.name; } }
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += names.add; return s; }
console.log(attempt(() => Object.defineProperty(names, "add", { get() { return 2; } })), attempt(() => Object.defineProperty(names, "add", { value: 3 })), attempt(() => delete names.add), attempt(() => Reflect.deleteProperty(names, "add")), drive(+(process.argv[2] ?? 50)));
