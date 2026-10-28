// A .cjs file whose text has no mark of CommonJS is strict code where import() loads it and sloppy code where require() does.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
await import("./aliases-its-arguments.cjs");
const { createRequire } = await import("node:module");
createRequire(import.meta.url)("./aliases-its-arguments-when-required.cjs");
