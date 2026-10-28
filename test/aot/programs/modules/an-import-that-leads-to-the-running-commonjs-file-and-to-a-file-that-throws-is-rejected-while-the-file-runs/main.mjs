// An ES module imports a CommonJS file that calls import() and drainMicrotasks() of bun:jsc. The imported module imports the file and a file that throws: the import() is rejected while the first file runs.
import { text } from "./file.cjs";
console.log("main", text);
