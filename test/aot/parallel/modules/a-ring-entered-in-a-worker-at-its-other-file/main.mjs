// Each thread enters the ring for itself, where its own first call enters it: the worker at b.mjs, the main thread at a.mjs.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
// Entry points: ./worker.mjs
import { Worker } from "node:worker_threads";
const worker = new Worker(new URL("./worker.mjs", import.meta.url));
await new Promise(resolve => worker.on("exit", resolve));
const first = import("./a.mjs");
await null;
await Promise.all([first, import("./b.mjs")]);
console.log("loaded");
/* Output:
a runs in the worker
b runs in the worker
loaded in the worker
b runs
a runs
loaded
*/
