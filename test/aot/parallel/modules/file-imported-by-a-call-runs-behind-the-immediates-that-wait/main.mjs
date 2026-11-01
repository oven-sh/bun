// Reference: bun build --compile
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
// An executable holds the text of the file: what the call asks for runs behind the jobs that wait and ahead of the immediates. The name says what `bun run` does, which reads the text on another thread.
setImmediate(() => console.log("immediate"));
queueMicrotask(() => console.log("job"));
const imported = await import("./imported.mjs");
console.log("after import", imported.v);
