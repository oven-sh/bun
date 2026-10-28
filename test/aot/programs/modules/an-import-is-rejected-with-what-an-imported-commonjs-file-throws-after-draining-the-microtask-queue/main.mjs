// An ES module imports a CommonJS file that calls import(), drainMicrotasks() of bun:jsc and then throws: every import() that leads to the file is rejected with the error, and the entry point never runs.
import { text } from "./file.cjs";
console.log("main", text);
