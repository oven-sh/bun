"use strict";
const names = { base: 2 };
Object.defineProperty(names, "scaled", { get: function () { return this.base * 10; } });
const heir = Object.create(names); heir.base = 5;
function drive(object, turns) { let s = 0; for (let i = 0; i < turns; i++) s += object.scaled; return s; }
const turns = +(process.argv[2] ?? 50);
console.log(drive(names, turns), drive(heir, turns));
