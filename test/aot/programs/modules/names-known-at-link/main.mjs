// Names that only exist at run time: imports of CommonJS, JSON and node: modules, export * of them, hoisted functions in a cycle, and the errors of each. The CommonJS files that a module imports are all evaluated at link, in import order, before a name is looked for in them, and the default export is the object `module.exports`, with what is added to it later. Plain Bun differs in both ("absent name", "CommonJS imported back while it runs"), so the output is stored.
async function attempt(name, run) {
  try {
    console.log(name + ":", await run());
  } catch (error) {
    console.log(name + ":", error.constructor.name, error.message.replace(/'[^']*[\\/]([^'\\/]+)'/g, "'$1'"));
  }
}

await attempt("named CommonJS", async () => (await import("./named-commonjs.mjs")).seen);
await attempt("default CommonJS", async () => (await import("./default-commonjs.mjs")).seen);
await attempt("namespace CommonJS", async () => (await import("./namespace-commonjs.mjs")).seen);
await attempt("__esModule CommonJS", async () => (await import("./flagged-commonjs.mjs")).seen);
await attempt("JSON", async () => (await import("./json-imports.mjs")).seen);
await attempt("node: through re-export", async () => (await import("./node-imports.mjs")).seen);
await attempt("star of one CommonJS", async () => (await import("./star-one-imports.mjs")).seen);
await attempt("star of two CommonJS", async () => (await import("./star-two-imports.mjs")).seen);
await attempt("star through second module", async () => (await import("./star-through-imports.mjs")).seen);
await attempt("hoisted function in cycle", async () => (await import("./cycle-a.mjs")).fromA());
await attempt("require during capture", async () => (await import("./capture-root.mjs")).seen);
await attempt("captured once", async () => (await import("./captured-once.mjs")).seen);
await attempt("CommonJS imported back while it runs", async () => (await import("./imported-back-root.mjs")).seen);
await attempt("CommonJS imported by import() while it runs", async () => Object.keys(await (await import("./running.cjs")).imported));
await attempt("absent name", () => import("./absent-name.mjs"));
await attempt("absent name again", () => import("./absent-name.mjs"));
await attempt("ambiguous by name", () => import("./ambiguous-name.mjs"));
await attempt("ambiguous in namespace", async () => (await import("./ambiguous-namespace.mjs")).seen);
await attempt("CommonJS body throws", () => import("./throwing-body.mjs"));
