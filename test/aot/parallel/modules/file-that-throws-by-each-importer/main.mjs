// A CommonJS file that throws, reached by each way a module can be its importer.
const log = [];
globalThis.log = log;
async function attempt(label, load) {
  try {
    const value = await load();
    console.log(label, "loaded", Object.keys(value).sort().join());
  } catch (error) {
    console.log(label, "threw", error && error.message);
  }
}
await attempt("static import", () => import("./imports-thrower.mjs"));
await attempt("static import again", () => import("./imports-thrower.mjs"));
await attempt("directly", () => import("./thrower.cjs"));
await attempt("in a cycle", () => import("./cycle-a.mjs"));
await attempt("in a cycle again", () => import("./cycle-b.cjs"));
await attempt("required", async () => require("./thrower-two.cjs"));
await attempt("imported while it runs", () => import("./imports-itself.cjs"));
await attempt("imported while it runs again", () => import("./imports-itself.cjs"));
await attempt("required back", async () => require("./requires-module.cjs"));
console.log(log.join(" "));
