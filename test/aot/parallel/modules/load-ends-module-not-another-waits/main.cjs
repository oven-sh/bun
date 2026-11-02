// import() loads a module that imports a CommonJS file and a module that is not there. The file calls import() twice and drainMicrotasks() of bun:jsc; what it imports imports the file, and a file that throws or a module that is not there: every load is rejected with its own error.
// Flags: --external ./absent-below-root.mjs --external ./absent-below-reader.mjs
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
require("./lines.cjs");
track("root", import("./root.mjs"));
