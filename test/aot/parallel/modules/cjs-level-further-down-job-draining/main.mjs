// The entry point imports a CommonJS file and a module that imports another CommonJS file. The first file queues a job and calls drainMicrotasks() of bun:jsc: the loader asks for the file one level further down in a step inside the drain, so that file runs behind the job.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import "./lines.cjs";
import "./drains.cjs";
import "./side.mjs";
lines.push("main runs");
