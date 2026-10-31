// The graph that asks.cjs runs in is loaded by import(): whoever waits for that graph goes on before late.cjs runs, and a file that late.cjs asks for in the same way comes later still.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
console.log("main begins");
const root = await import("./root.mjs");
console.log("main goes on with", root.name);
await new Promise(resolve => (globalThis.lastHasRun = resolve));
console.log("main ends");
