// The plain case: exports that are read, stored and called by name, as TypeScript emits them.
"use strict";
const lib_1 = require("./lib");
const old = require("./lib");
console.log("read", lib_1.K, lib_1.quoted, lib_1["viaModule"], lib_1.conditional, lib_1.missing, lib_1.__esModule, lib_1.helper);
console.log("call", (0, lib_1.add)(1, 2), lib_1.add(3, 4), lib_1.arrow(5), old.add(5, 6), require("./lib").add(7, 8), lib_1.callsOwn());
console.log("live", lib_1.counter, lib_1.bump(), lib_1.counter, old.counter);
lib_1.setLate("set"); console.log("late", lib_1.late);
console.log("new", new lib_1.Point(3).x, lib_1.Point.name, lib_1.add.name, lib_1.arrow.name, lib_1.setLate.name);
console.log("tag", lib_1.tag`a${1}`, lib_1.add?.(1, 1), lib_1.missing?.(1), lib_1.K?.toString());
console.log("stores", lib_1.compound, lib_1.nil, lib_1.fromArray, lib_1.second, lib_1.fromObject);
const { K, add: plus, missing = "default", counter } = require("./lib");
console.log("pattern", K, plus(1, 1), missing, counter);
function lazy() { const inner = require("./lib"); return inner.K + inner.add(1, 1); }
console.log("lazy", lazy(), lazy());
function closure() { return () => lib_1.K + old.K; }
console.log("closure", closure()());
try { lib_1.missing(); } catch (e) { console.log("throws", e instanceof TypeError); }
console.log("tested", lib_1 && "truthy", !lib_1, lib_1 ? 1 : 2);
require("./lib");
