// Reference: bun build --compile
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
import("./h.mjs");
await import("./i.mjs");
console.log("main goes on");
