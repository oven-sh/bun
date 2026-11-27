// Two classes in a bundler's wrappers. The callback of a wrapper is a module of its own, which the loader enters at most once, and the file around it runs once:
// the classes are evaluated at most once, as if they stood at the top: the prototype of an instance is named by its allocation and read off no class object.
// COUNT: operation:operationAOTGetClassPrototype = 0
// COUNT: operation:operationAOTSetConstructPrototype = 0
// What leans on "once" is enforced: each of the two callbacks stops at a second entry, and says so once at its first.
// COUNT: operation:operationAOTEnterBodyThatRunsOnce = 2
// Both callbacks hold nothing that types make cheaper: they are written straight as before, and the straight form calls the stop itself.
// STATISTIC: StraightUnitsCompiled >= 2
"use strict";
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var Base, Heir;
var initBase = __esm(() => { Base = class Base { size = 0; constructor(n) { this.size = n; } }; });
var initHeir = __esm(() => { initBase(); Heir = class Heir extends Base { mark = 1; both() { return this.size + this.mark; } }; });
const kept = new Array(64).fill(null);
function run() { let sum = 0; for (let round = 0; round < 100000; round++) { const made = new Heir(round); kept[round & 63] = made; sum += made.both(); } return sum; }
initHeir();
console.log(run());
