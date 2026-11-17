"use strict";
const names = Object.create(null);
Object.defineProperty(names, "fixed", { value: 1 });
function attempt(act) { try { return String(act()); } catch (error) { return error.constructor.name; } }
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += names.fixed; return s; }
console.log(attempt(() => { names.fixed = 2; }), attempt(() => delete names.fixed), attempt(() => Object.defineProperty(names, "fixed", { value: 3 })), attempt(() => Object.defineProperty(names, "fixed", { value: 1 }) === names), attempt(() => Reflect.defineProperty(names, "fixed", { value: 4 })), attempt(() => Reflect.set(names, "fixed", 5)), drive(+(process.argv[2] ?? 50)));
