// A CommonJS module that threw while it was evaluated is evaluated again at the next require, as under `bun run`: each evaluation makes symbols of its own. That of the first evaluation is a name, for as long as the module has not failed: that is tested where the symbol is used. Those of a module that cannot throw are names without a test.
// IR+ ConstantSymbol "[^"]*:own"
// IR= 1 readOwn GetById .*:own
// IR= 1 readOwn GetByVal
// IR= 0 readKept GetByVal
// IR+ ConstantSymbol "[^"]*:kept"
"use strict";
globalThis.seen = [];
globalThis.holder = {};
const { kKept } = require("./cannot-throw");
function readKept(object) { return object[kKept]; }
for (const time of [1, 2, 3]) {
    try {
        const { kOwn, readOwn, stamp } = require("./throws-twice");
        console.log("got", String(kOwn), readOwn(stamp({})), readOwn(holder), readOwn.name);
    } catch (error) {
        console.log("caught", error instanceof TypeError ? "a TypeError" : error.message);
    }
}
console.log("symbols", seen.length, seen[0] === seen[1], seen[1] === seen[2], new Set(seen).size);
console.log("keys on an object that outlives the evaluations", Object.getOwnPropertySymbols(holder).length, Object.getOwnPropertySymbols(holder).map(symbol => holder[symbol]).join());
console.log("the last is the one that is exported", seen[2] === require("./throws-twice").kOwn, holder[require("./throws-twice").kOwn]);
holder[kKept] = "kept";
console.log(readKept(holder), readKept({}), readKept.name, kKept === require("./cannot-throw").kKept);
