// The generators of a function whose calls all stand in loops hang right below %GeneratorPrototype%, without an object under `prototype` of their own.
// The open of the loop finds them as they were made: no list of the iterator and its `next` is made, which is the state of a loop that goes by the protocol, and no cell for the state of the iteration.
// COUNTER: operationAOTNewArray = 0
// COUNTER: operationAOTNewHeapFrame = 0
function* upTo(limit: number): Generator<number> { for (let i = 0; i < limit; i++) yield i; }
function* pairs(limit: number): Generator<number> { for (let i = 0; i < limit; i++) { yield i; yield -i; } }
let total = 0;
for (let round = 0; round < 100_000; round++) for (const value of upTo(8)) total += value;
for (let round = 0; round < 100_000; round++) for (const value of pairs(4)) { if (value < -2) break; total += value; }
console.log(total);
