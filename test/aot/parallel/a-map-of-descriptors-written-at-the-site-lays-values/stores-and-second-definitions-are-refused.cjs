"use strict";
const names = Object.create(null, { fixed: { value: 1 }, loose: { value: 2, writable: true, configurable: true } });
function attempt(act) { try { return String(act()); } catch (error) { return error.constructor.name; } }
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) { names.loose = i; s += names.fixed + names.loose; } return s; }
console.log(attempt(() => { names.fixed = 2; }), attempt(() => delete names.fixed), attempt(() => Object.defineProperties(names, { fixed: { value: 3 } })), attempt(() => delete names.loose), drive(+(process.argv[2] ?? 50)));
