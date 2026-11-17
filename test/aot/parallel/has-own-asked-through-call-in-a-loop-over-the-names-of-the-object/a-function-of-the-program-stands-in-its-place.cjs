"use strict";
function refuses(name) { return name === "b" ? false : Object.prototype.hasOwnProperty.call(this, name); }
const askers = [Object.prototype.hasOwnProperty, refuses];
function names(holder, has) { var found = "", name; for (name in holder) found += name + (has.call(holder, name) ? "+" : "-"); return found; }
function byOwnCall(holder) { var has = { call(one, name) { return name === "a"; } }, found = "", name; for (name in holder) found += name + (has.call(holder, name) ? "+" : "-"); return found; }
let told = new Set(); for (let turn = 0; turn < 6000; turn++) { told.add(names({ a: 1, b: 2 }, askers[turn & 1])); told.add(byOwnCall({ a: 1, b: 2 })); }
console.log([...told].sort().join(" | "));
