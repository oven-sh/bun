// An ES module imports a CommonJS file that calls import(), drainMicrotasks() of bun:jsc and then throws: every import() that leads to the file is rejected with the error, and the entry point never runs.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import { text } from "./file.cjs";
console.log("main", text);
