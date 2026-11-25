// A late require fires while a.cjs is half done, and b.cjs reads names of a.cjs that getters stand for. The getters are defined before anything else runs, so the names are variables, dead zones and all.
// Under: --aot-testing=CheckEffectsAtRunTime: `all[name]` in the for-in loop of a.cjs makes and stores a closure that the literal left unmade: the row of that read says so
// STATISTIC: ModulesWithNames = 2 Todo: a CommonJS file that may run again keeps its exports object, and both files here may
"use strict";
globalThis.hook = function (where) { const b = require("./b.cjs"); return where + ": " + b.peek(); };
const a = require("./a.cjs");
console.log(globalThis.hook("after"));
console.log(a.f(), a.x, a.v, a.C.name, a.l);
