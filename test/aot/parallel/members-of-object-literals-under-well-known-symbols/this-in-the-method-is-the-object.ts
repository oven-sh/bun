// A member of an object literal under a well-known symbol: this in the method is the object.
const o = { k: 3, [Symbol.iterator]() { const self = this; let i = 0; return { next(): IteratorResult<number> { return i < self.k ? { value: ++i, done: false } : { value: undefined, done: true }; } }; } };
function sum(l: Iterable<number>): number { let s = 0; for (const x of l) s += x; return s; }
console.log(sum(o)); o.k = 5; const small = { ...o, k: 1 }; console.log(sum(o), sum(small));
