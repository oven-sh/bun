// In an executable, as in any bundle, a CommonJS module that threw while it was evaluated is not evaluated again: the next require hands out what it had exported by then. Its code runs once, so the symbols it makes are names, as those of a module that cannot throw.
// IR+ ConstantSymbol "[^"]*:own"
// IR+ ConstantSymbol "[^"]*:kept"
// IR= 0 readOwn GetByVal
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
