// Two calls of import(), one behind the other, each under a store of AsyncLocalStorage of its own. The first module imports a CommonJS file that calls drainMicrotasks() of bun:jsc before it exports a name. The second module takes that name, so its load waits for the end of the file. Each module reads the store of its own call.
// `bun <file>` loads the two graphs in the order in which the threads of its transpiler finish their texts: a slow build of Bun prints three outputs in eight runs, and in one of them drains.cjs runs for the second call. So what the executable prints stands here.
const { AsyncLocalStorage } = require("node:async_hooks");
const store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
store.run("first", () => import("./first.mjs"));
store.run("second", () => import("./second.mjs"));

/* Output:
quiet first
drains begins first
drains ends first
first first
second a2 second
*/
