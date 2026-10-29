// One text without a mark of CommonJS in two .cjs files: import() loads the one and require() the other. Each prints whether it is strict code.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
await import("./aliases-its-arguments.cjs");
const { createRequire } = await import("node:module");
createRequire(import.meta.url)("./aliases-its-arguments-when-required.cjs");
