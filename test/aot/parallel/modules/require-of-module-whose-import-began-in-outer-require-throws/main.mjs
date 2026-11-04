// file.cjs runs while the loader loads the graph of main.mjs, and requires main.mjs: the whole graph runs inside that require(). The two import() calls are no part of it: what they name runs when it has returned, and asks.cjs can require wanted.mjs.
// `bun run` takes the steps of the calls inside the require(): the inner require() cannot take those of wanted.mjs, and throws.
// Reference: bun build --compile
// Todo: `bun build --compile` runs file.cjs to its end first. node refuses a require() in a cycle.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import "./first.mjs";
import("./asks.cjs").then(
  () => console.log("asks is imported"),
  error => console.log("asks fails:", error.name, error.message.replace(/"[^"]*wanted.mjs"/, "wanted.mjs")),
);
console.log("main runs");
