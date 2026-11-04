// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
// `bun run` reads require("fs") as require("node:fs") in a CommonJS file that an import has loaded, and as it is written in one that require() has loaded. The first load of the file counts.
// It does so where its transpiler reads both the call and the name. Whatever else asks for "fs" finds the entry of the program in require.cache, in either file.
// On one thread it reads every file as require() does, and so does an executable that is started with the variable set.
import { createRequire } from "node:module";
const load = createRequire(import.meta.url);
load.cache["fs"] = { exports: { readFileSync: 1 } };
load.cache["path"] = { exports: { join: 1 } };
const imported = await import("./imported.cjs");
console.log("imported", imported.default.ask().join());
console.log("required", load("./required.cjs").ask().join());
console.log("imported, then required", load("./imported.cjs").ask().join());
console.log("required, then imported", (await import("./required.cjs")).default.ask().join());
console.log("an ES module", typeof load("fs").readFileSync, typeof require("fs").readFileSync, typeof import.meta.require("fs").readFileSync);
