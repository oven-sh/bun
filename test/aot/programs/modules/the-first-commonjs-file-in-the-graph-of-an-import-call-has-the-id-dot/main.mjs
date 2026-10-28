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
