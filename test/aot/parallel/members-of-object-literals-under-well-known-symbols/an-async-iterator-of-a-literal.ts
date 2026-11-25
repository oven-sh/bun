// A member of an object literal under a well-known symbol: an async iterator of a literal.
const o = { [Symbol.asyncIterator]() { let i = 0; return { async next(): Promise<IteratorResult<number>> { return i < 3 ? { value: ++i, done: false } : { value: undefined, done: true }; } }; } };
async function sum(l: AsyncIterable<number>): Promise<number> { let s = 0; for await (const x of l) s += x; return s; }
sum(o).then(s => console.log(s));
