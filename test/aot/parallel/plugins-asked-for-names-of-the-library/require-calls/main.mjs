Bun.plugin({
  name: "swap",
  setup(build) {
    build.onResolve({ filter: /^(os|path|fs\/promises)$/, namespace: "node" }, (args) => ({ path: args.path, namespace: "swapped" }));
    build.onResolve({ filter: /^jsc$/, namespace: "bun" }, (args) => ({ path: args.path, namespace: "swapped" }));
    build.onResolve({ filter: /^(os|path)$/ }, (args) => ({ path: args.path, namespace: "swapped" }));
    build.onLoad({ filter: /.*/, namespace: "swapped" }, (args) => ({ contents: "module.exports = " + JSON.stringify("plugin " + args.path), loader: "js" }));
  },
});
const count = process.argv.length;
const kind = (it) => (typeof it === "string" ? it : typeof it === "object" && it && typeof it.default === "string" ? it.default : typeof it);
const pick = count > 5 ? "node:path" : "node:os";
const one = "node:os";
const ours = "bun:jsc";
const bare = "os";
console.log(kind(require(pick)), kind(require(one)), kind(require(ours)), kind(require(bare)), kind(require("os")));
console.log(kind(import.meta.require(pick)), kind(import.meta.require(one)), kind(import.meta.require("node:os")));
