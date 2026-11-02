// An ES module imports a CommonJS file that calls import() and drainMicrotasks() of bun:jsc. The imported module imports the file and a file that throws: the import() is rejected while the first file runs.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import { text } from "./file.cjs";
console.log("main", text);
