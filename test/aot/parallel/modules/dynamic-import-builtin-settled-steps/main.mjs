// Jobs of the program count the steps in which each import() is settled.
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
  const namespace = await start();
  console.log(what, "is imported after", globalThis.jobs - from, typeof namespace.default);
};

await load("node:path", () => import("node:path"));
await load("node:path again", () => import("node:path"));
await load("what the entry point imports", () => import("node:module"));
await load("an importer of node:path", () => import("./path.mjs"));
await load("an importer of node:events", () => import("./events.mjs"));
await load("node:events", () => import("node:events"));
console.log(typeof createRequire(import.meta.url)("node:os").cpus);
await load("what was required", () => import("node:os"));
await load("the same without the prefix", () => import("os"));
await load("bun:jsc", () => import("bun:jsc"));
await load("bun", () => import("bun"));

await Promise.all([load("node:url", () => import("node:url")), load("an importer of node:url", () => import("./url.mjs"))]);
await Promise.all([load("an importer of node:util", () => import("./util.mjs")), load("node:util", () => import("node:util"))]);

const order = [];
await Promise.all([
  import("node:assert").then(() => order.push("node:assert")),
  import("./none.mjs").then(() => order.push("a file")),
  import("node:assert").then(() => order.push("node:assert again")),
  import("node:path").then(() => order.push("node:path")),
  Promise.resolve().then(() => order.push("a job")),
]);
console.log(order.join(", "));
counts = false;
