// For await, async iterators and a generator resumed while the module is suspended.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const seen = [];
const source = { [Symbol.asyncIterator]() { return { next() { seen.push(attempt(() => later.x)); return Promise.resolve({ done: true }); } }; } };
for await (const v of source) { }
await using_();
async function using_() { seen.push(attempt(() => later.x)); }
const later = { x: 1 };
console.log(seen.join("|"), later.x);
