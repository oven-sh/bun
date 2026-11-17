"use strict";
var has = Object.prototype.hasOwnProperty;
let traps = 0;
function names(holder) { var found = "", name; for (name in holder) found += name + (has.call(holder, name) ? "+" : "-"); return found; }
const watched = new Proxy({ p: 1, q: 2 }, { getOwnPropertyDescriptor(target, key) { traps++; return key === "q" && traps % 5 === 0 ? undefined : Reflect.getOwnPropertyDescriptor(target, key); } });
const list = [5, 6]; list.extra = 1;
let told = new Set(); for (let turn = 0; turn < 4000; turn++) told.add(names(turn % 4 === 0 ? list : turn % 4 === 1 ? new String("ab") : turn % 4 === 2 ? watched : { o: 1 }));
console.log([...told].sort().join(" | "), traps > 0);
