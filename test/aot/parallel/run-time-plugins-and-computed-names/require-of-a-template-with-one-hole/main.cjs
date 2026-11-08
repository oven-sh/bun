Bun.plugin({
  name: "swap",
  setup(build) {
    build.onResolve({ filter: /^\.\/(a|b|c)\.(mjs|cjs|json)$/ }, (args) => ({ path: args.path, namespace: "swapped" }));
    build.onLoad({ filter: /.*/, namespace: "swapped" }, (args) => ({ contents: "module.exports = " + JSON.stringify("plugin " + args.path), loader: "js" }));
  },
});
const unseen = (x) => [x][JSON.parse("0")];
const name = unseen("a");
console.log(require(`./${name}.cjs`));
