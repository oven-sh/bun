Bun.plugin({
  name: "swap",
  setup(build) {
    build.onResolve({ filter: /^(fs|os)$/ }, (args) => ({ path: args.path, namespace: "swapped" }));
    build.onResolve({ filter: /^(fs|os)$/, namespace: "node" }, (args) => ({ path: args.path, namespace: "swapped" }));
    build.onLoad({ filter: /.*/, namespace: "swapped" }, (args) => ({ contents: "module.exports = " + JSON.stringify("plugin " + args.path), loader: "js" }));
  },
});
const pick = process.argv.length > 5 ? "os" : "fs";
const long = process.argv.length > 5 ? "node:os" : "node:fs";
const one = "node:fs";
console.log(require.resolve(pick), require.resolve("fs"), require.resolve(long), require.resolve(one));
