// The entry point imports a CommonJS file. The file requires an ES module whose own CommonJS file calls drainMicrotasks() of bun:jsc, then calls import() on a module that imports the file back, and throws: the error ends the program and rejects the call.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import "./lines.cjs";
import "./file.cjs";
lines.push("main runs");
