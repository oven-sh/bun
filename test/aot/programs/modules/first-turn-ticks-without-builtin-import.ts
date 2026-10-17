// The first turn of an ES module that is itself the first to read process.nextTick: whatever order plain Bun has there, the compiled program has too.
export {};
const log: string[] = [];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("promise job"));
setImmediate(() => console.log(log.join(", ")));
