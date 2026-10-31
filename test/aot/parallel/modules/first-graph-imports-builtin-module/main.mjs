// Jobs of the program count the steps in which each graph is loaded.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
// Alone: the steps follow from which built-in modules were imported before in the process
import { createRequire } from "node:module";

globalThis.jobs = 0;
let counts = true;
(function count() {
  if (!counts || globalThis.jobs > 2000) return;
  globalThis.jobs++;
  Promise.resolve().then(count);
})();
globalThis.tell = (...what) => console.log(...what, "after", globalThis.jobs - globalThis.start);
const load = async (what, start) => {
  const from = (globalThis.start = globalThis.jobs);
  await start();
  console.log(what, "is imported after", globalThis.jobs - from);
};

await load("what imports no built-in module", () => import("./none.mjs"));
await load("what the entry point imports too", () => import("./module.mjs"));
await load("the first importer of node:path", () => import("./path-first.mjs"));
await load("the second importer of node:path", () => import("./path-second.mjs"));
console.log(typeof createRequire(import.meta.url)("node:os").cpus);
await load("the first importer of what was required", () => import("./os.mjs"));
await load("an importer of three", () => import("./three.mjs"));
await load("an importer of an importer", () => import("./above.mjs"));
await load("an importer beside two levels", () => import("./beside.mjs"));
await load("an import of no name", () => import("./no-name.mjs"));
await load("a namespace", () => import("./namespace.mjs"));
await load("a name without the prefix", () => import("./without-prefix.mjs"));
await load("the same with the prefix", () => import("./with-prefix.mjs"));
await load("names of bun", () => import("./bun.mjs"));
createRequire(import.meta.url)("./required.mjs");
await load("what a required module imports too", () => import("./after-required.mjs"));
const one = import("./one-of-two.mjs");
const other = import("./other-of-two.mjs");
await load("two at once", () => Promise.all([one, other]));
counts = false;
