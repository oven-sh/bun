// A late require fires while a.cjs is half done, and b.cjs reads names of a.cjs that getters stand for. The getters are defined before anything else runs, so the names are variables, dead zones and all.
// STATISTIC: ModulesWithNames = 2
"use strict";
globalThis.hook = function (where) { const b = require("./b.cjs"); return where + ": " + b.peek(); };
const a = require("./a.cjs");
console.log(globalThis.hook("after"));
console.log(a.f(), a.x, a.v, a.C.name, a.l);
