// Reference: bun build --compile
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
await Promise.all([
  import("./a.mjs").then(() => console.log("a settled")),
  import("./b.mjs").then(() => console.log("b settled")),
  import("./c.mjs").then(() => console.log("c settled")),
]);
