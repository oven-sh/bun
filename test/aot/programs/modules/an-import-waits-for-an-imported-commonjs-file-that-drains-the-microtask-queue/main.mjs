// An ES module imports a CommonJS file that calls import() and then drainMicrotasks() of bun:jsc: the importer of the file runs first, then the modules that the file imported, which see everything it exports.
import { text } from "./file.cjs";
console.log("main", text);
