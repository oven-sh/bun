// An ES module imports names of a CommonJS file as a bundler writes it, which stores them again: it holds what they were when the file was linked.
import { count, label, inc, late, fill } from "./lib.cjs";
console.log(count, label, typeof late);
inc(); inc();
console.log(count, label);
fill();
console.log(typeof late);
