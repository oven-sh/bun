// between.mjs imports two CommonJS files, and the first of them queues the first tick of the process. The tick runs right behind that file, ahead of the second.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
// On a busy machine `bun <file>` as users run it runs second.cjs first (11-03): which text its transpiler's threads finish first decides. On one thread it is stable.
import "./between.mjs";
console.log("main runs");
