// The getters of a.cjs are defined behind a call that runs other code: whoever looks in front of them finds no such names, so a.cjs keeps its object.
// STATISTIC: ModulesWithValue = 2
"use strict";
globalThis.hook = function (where) { const b = require("./b.cjs"); return where + ": " + b.peek(); };
const a = require("./a.cjs");
console.log(globalThis.hook("after"));
console.log(a.f(), a.x);
