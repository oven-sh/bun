// `export *` of an ES module and of a CommonJS module that export the same name: the name is ambiguous, so importing it is a SyntaxError and the namespace object does not have it. A local export wins, a name that reaches one binding on two paths is not ambiguous, and a module reached on two paths counts on each.
async function attempt(label, run) {
  try {
    console.log(label + ":", await run());
  } catch (error) {
    console.log(label + ":", error.constructor.name, error.message.replace(/'[^']*[\\/]([^'\\/]+)'/g, "'$1'"));
  }
}
const describe = namespace => [Object.keys(namespace).join(), "both" in namespace, namespace.both, namespace.onlyDynamic];

await attempt("names in one module only", async () => (await import("./imports-unambiguous.mjs")).seen);
await attempt("name in both", () => import("./imports-both.mjs"));
await attempt("name in both again", () => import("./imports-both.mjs"));
await attempt("name in both, one level up", () => import("./imports-both-from-outer.mjs"));
await attempt("namespace", async () => describe(await import("./stars.mjs")));
await attempt("namespace one level up", async () => describe(await import("./outer.mjs")));
await attempt("local export wins", async () => describe(await import("./shadows.mjs")));
await attempt("local export wins by name", async () => (await import("./imports-shadowed.mjs")).seen);
await attempt("hidden on one of two paths", async () => describe(await import("./diamond.mjs")));
await attempt("hidden on one of two paths by name", () => import("./imports-from-diamond.mjs"));
await attempt("star cycle", async () => describe(await import("./star-cycle-b.mjs")));
