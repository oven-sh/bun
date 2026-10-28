// Microtasks of the program count the steps in which each file is loaded. A file that imports from "bun" loads no module for it; the first file that re-exports from "bun" waits for the loader to load that module, and later ones find it loaded.
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
  const loaded = await start();
  console.log(what, "is imported after", globalThis.jobs - from);
  return loaded;
};
await load("names", () => import("./imports-names.mjs"));
await load("the namespace and the default export", () => import("./imports-namespace.mjs"));
await load("nothing", () => import("./imports-nothing.mjs"));
const star = await load("the first re-export", () => import("./exports-star.mjs"));
const named = await load("the second re-export", () => import("./exports-names.mjs"));
const namespace = await load("a re-exported namespace", () => import("./exports-namespace.mjs"));
await load("names again", () => import("./imports-names-again.mjs"));
console.log(star.version === Bun.version, named.version === Bun.version, namespace.all.version === Bun.version, namespace.all === Bun);
counts = false;
