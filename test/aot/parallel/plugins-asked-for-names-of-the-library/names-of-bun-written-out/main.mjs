Bun.plugin({
  name: "swap",
  setup(build) {
    build.onResolve({ filter: /^(jsc|ffi)$/, namespace: "bun" }, (args) => ({ path: args.path, namespace: "swapped" }));
    build.onLoad({ filter: /.*/, namespace: "swapped" }, (args) => ({ contents: "module.exports = " + JSON.stringify("plugin " + args.path), loader: "js" }));
  },
});
const kind = (it) => (typeof it === "string" ? it : typeof it === "object" && it && typeof it.default === "string" ? it.default : typeof it);
console.log(kind(await import("bun:jsc")), kind(require("bun:jsc")), kind(import.meta.require("bun:jsc")), kind(await import(`bun:jsc`)), kind(await import("bun:" + "jsc")), kind(await import(process.argv.length > 5 ? "bun:ffi" : "bun:jsc")), kind(require(process.argv.length > 5 ? "bun:ffi" : "bun:jsc")));
console.log(typeof (await import("bun:sqlite")).Database, typeof require("bun:sqlite").Database, typeof (await import("bun")).version);
