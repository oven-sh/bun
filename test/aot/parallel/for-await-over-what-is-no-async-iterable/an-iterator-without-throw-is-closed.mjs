const log = [];
const plain = { [Symbol.iterator]() { return this; }, next() { return { value: 1, done: false }; }, return() { log.push("return"); return {}; } };
async function* relay() { yield* plain; }
const stream = relay();
await stream.next();
try { await stream.throw(new Error("stop")); } catch (error) { log.push(error.name); }
console.log(log.join());
