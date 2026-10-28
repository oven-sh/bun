// A file whose text says neither CommonJS nor ES module is what its extension says where require() loads it, and what the "type" of its package says where import loads it.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
import { createRequire } from "node:module";
import "./calls-require.mjs";
import * as imported from "./imported.cjs";
import "./module-package/calls-require.cjs";
const require = createRequire(import.meta.url);
console.log(Object.keys(imported), Object.keys(require("./required.cjs")));
require("./required.mjs");
console.log(Object.keys(await import("./imported-late.cjs")));
