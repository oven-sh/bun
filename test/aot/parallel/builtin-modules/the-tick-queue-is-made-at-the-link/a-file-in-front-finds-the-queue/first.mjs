const log = [];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("job"));
queueMicrotask(() => log.push("microtask"));
export const order = new Promise(resolve => setImmediate(() => resolve(log)));
log.push("body");
