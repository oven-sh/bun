// An ES module imports two CommonJS files that each call import() and drainMicrotasks() of bun:jsc, and the second throws: both calls settle, and the entry point never runs.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import "./lines.cjs";
import "./first.cjs";
import "./second.cjs";
lines.push("main");
