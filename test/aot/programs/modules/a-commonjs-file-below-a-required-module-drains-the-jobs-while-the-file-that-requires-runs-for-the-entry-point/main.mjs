// The entry point imports a CommonJS file. The file requires an ES module whose own CommonJS file calls drainMicrotasks() of bun:jsc, then calls import() on a module that imports the file back, and throws: the error ends the program and rejects the call.
import "./lines.cjs";
import "./file.cjs";
lines.push("main runs");
