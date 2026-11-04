// a loop over a parameter that is written to be a generator is handed an iterator made by hand, whose `return` counts its calls
function* count(limit: number) { for (let i = 0; i < limit; i++) yield i; }
function firstOver(things: Generator<number>, bound: number) { for (const thing of things) { if (thing > bound) return thing; } return -1; }
let closed = 0;
function byHand(limit: number) { let i = 0; return { [Symbol.iterator]() { return this; }, next() { return i < limit ? { done: false, value: i++ } : { done: true, value: undefined }; }, return() { closed++; return {}; } }; }
function deed(bound: number) { return firstOver(byHand(4) as any, bound); }
console.log(String(firstOver(count(4), 1)));
for (let i = 0; i < 3; i++) console.log(String(firstOver(count(4), i)));
console.log(String(deed(1)), String(closed));
console.log(String(deed(9)), String(closed));
console.log(String(firstOver(count(4), 2)));
