// A class that is not proven to be evaluated once reads `prototype` off its class object at every construction. The property is neither writable nor
// configurable: where it lies is remembered by the structure of the class object, and the lookup by name is left to the first construction behind a collection.
// 200,000 constructions: without the remembered place the operation is entered 200,000 times.
// COUNT: operation:operationAOTGetClassPrototype <= 200
"use strict";
let Written;
function write() { Written = class Written { constructor(n) { this.size = n; } twice() { return this.size * 2; } }; }
function written(step) { return class InTurns { constructor(n) { this.size = n + step; } twice() { return this.size * 2; } }; }
write();
const First = written(1), Second = written(2);
const kept = new Array(64).fill(null);
function run() {
    let sum = 0;
    for (let round = 0; round < 100000; round++) {
        const made = new Written(round);
        const other = round & 1 ? new First(round) : new Second(round);
        kept[round & 63] = made;
        kept[(round + 1) & 63] = other;
        sum += made.twice() + other.twice();
    }
    return sum;
}
console.log(run());
if (globalThis.never) write();
