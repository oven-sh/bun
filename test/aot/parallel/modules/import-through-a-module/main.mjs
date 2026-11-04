// Reference: bun build --compile
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
// Todo: an import() of compiled code waits as many jobs as the loader of `bun run` takes, and more for a deeper graph
await Promise.all([
  import("./a.mjs").then(() => console.log("a settled")),
  import("./b.mjs").then(() => console.log("b settled")),
]);
