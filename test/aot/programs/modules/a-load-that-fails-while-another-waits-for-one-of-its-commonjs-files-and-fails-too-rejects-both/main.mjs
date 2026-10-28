// An ES module imports a CommonJS file that calls import() and drainMicrotasks() of bun:jsc, and a file that throws. The imported module imports the first file and another file that throws: each load is rejected with its own error.
import "./lines.cjs";
import "./first.cjs";
import "./second.cjs";
lines.push("main");
