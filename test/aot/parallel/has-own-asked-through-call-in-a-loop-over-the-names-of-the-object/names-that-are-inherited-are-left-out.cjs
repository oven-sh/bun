"use strict";
var has = Object.prototype.hasOwnProperty;
function Base() { this.own = 1; } Base.prototype.shared = 2; Base.prototype.other = 3;
function names(holder) { var found = "", name; for (name in holder) if (has.call(holder, name)) found += name + ","; else found += "(" + name + "),"; return found; }
const below = Object.create({ above: 1 }); below.mine = 2;
let told = new Set(); for (let turn = 0; turn < 6000; turn++) told.add(names(turn % 3 === 0 ? new Base() : turn % 3 === 1 ? below : { plain: 1 }));
console.log([...told].sort().join(" | "));
