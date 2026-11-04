// Two calls of import() in one job enter a ring of two modules at its two files. The loader takes their steps side by side, and comes to the end of the first graph first.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
// `bun <file>` as users run it ends with a ReferenceError twice in 600 runs on a busy machine (11-03): a.mjs runs in front of b.mjs where b's text comes late from the transpiler's threads. On one thread it does not.
await Promise.all([import("./a.mjs"), import("./b.mjs")]);
console.log("loaded");
