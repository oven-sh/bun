"use strict";
var has = Object.prototype.hasOwnProperty;
function walk(holder, how) { var found = "", name; for (name in holder) { if (how === 1 && name === "a") delete holder.c; if (how === 2 && name === "a") holder.z = 1; if (how === 3 && name === "b") Object.defineProperty(holder, "c", { get() { return 9; }, enumerable: true, configurable: true }); found += name + (has.call(holder, name) ? "+" : "-") + (has.call(holder, "c") ? "c" : "_"); } return found; }
let told = new Set(); for (let turn = 0; turn < 8000; turn++) told.add((turn & 3) + ":" + walk({ a: 1, b: 2, c: 3, d: 4 }, turn & 3));
console.log([...told].sort().join(" | "));
