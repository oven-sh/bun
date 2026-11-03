// file.cjs runs while the loader loads the graph of main.mjs, and requires main.mjs: the whole graph runs inside that require(), and so do the steps of the two import() calls.
// asks.cjs runs in one of those steps and requires wanted.mjs, whose own steps wait behind it in the same require(): the inner require() cannot take them, and throws.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import "./first.mjs";
import("./asks.cjs").then(
  () => console.log("asks is imported"),
  error => console.log("asks fails:", error.name, error.message.replace(/"[^"]*wanted.mjs"/, "wanted.mjs")),
);
console.log("main runs");
