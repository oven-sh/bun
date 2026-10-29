// The first commonjs file in the graph of an import call has the id dot.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
// Alone: it asks which file the executable was started as (import.meta.main, require.main, module.id, module.parent, process.argv[1])
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Neither leaves a module object behind: a built-in module, and a file that throws.
require("node:fs");
try {
  require("./throws.cjs");
} catch (error) {
  console.log("threw", error.message);
}
await import("./graph.mjs");
await import("./later.cjs");
