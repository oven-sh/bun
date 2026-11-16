const early = { [Symbol.asyncIterator]() { return { next() { return Promise.resolve({ done: false, value: late.rate }); } }; } };
async function deed() { try { for await (const value of early) return value; } catch (error) { return error.name; } }
const before = await deed();
const late = { rate: 0.2 };
console.log(before, await deed());
