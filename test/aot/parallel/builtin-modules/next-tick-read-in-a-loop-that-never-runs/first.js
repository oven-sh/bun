const log = ["first"];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("promise job"));
export const order = new Promise(resolve => setImmediate(() => resolve(log)));
