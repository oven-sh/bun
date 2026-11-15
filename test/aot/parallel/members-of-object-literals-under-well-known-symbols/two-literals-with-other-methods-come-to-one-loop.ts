// A member of an object literal under a well-known symbol: two literals with other methods come to one loop.
function sum(l: any): number { let s = 0; for (const x of l) s += x; return s; }
const a = { [Symbol.iterator]() { let i = 0; return { next() { return i < 3 ? { value: ++i, done: false } : { value: undefined, done: true }; } }; } };
const b = { [Symbol.iterator]() { let i = 10; return { next() { return i < 12 ? { value: ++i, done: false } : { value: undefined, done: true }; } }; } };
for (let run = 0; run < 4; run++) console.log(sum(run & 1 ? a : b));
