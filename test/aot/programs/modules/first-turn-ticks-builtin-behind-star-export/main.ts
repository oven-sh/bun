// The entry point reaches node:fs only through `export *` of another module. It belongs to the graph all the same, and is loaded before any of it is evaluated.
import * as names from "./names.ts";
const log: string[] = [typeof names.existsSync];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("promise job"));
setImmediate(() => console.log(log.join(", ")));
