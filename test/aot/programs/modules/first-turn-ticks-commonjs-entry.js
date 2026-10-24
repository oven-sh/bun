// A CommonJS entry point runs its process.nextTick callbacks ahead of its promise jobs, as in plain Bun and Node.
const { existsSync } = require("node:fs");
const log = [typeof existsSync];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("promise job"));
setImmediate(() => console.log(log.join(", ")));
