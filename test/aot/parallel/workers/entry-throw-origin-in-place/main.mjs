// Flags: --compile-in-place
// Entry points: ./commonjs-entry.cjs ./module-entry.mjs
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { Worker } from "node:worker_threads";
const firstMessage = entry => new Promise(resolve => new Worker(entry).once("message", resolve));
console.log(await firstMessage("./commonjs-entry.cjs"));
console.log(await firstMessage("./module-entry.mjs"));
