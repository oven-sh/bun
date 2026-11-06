// import() loads a module that takes a name of a CommonJS file. The file calls import() on that module and drainMicrotasks() of bun:jsc, and exports the name behind that: both calls settle when the file has ended.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
require("./lines.cjs");
track("outer", import("./root.mjs"));
