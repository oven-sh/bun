Bun.plugin({
  name: "swap",
  setup(build) {
    build.onResolve({ filter: /[ab]\.cjs$/ }, (args) => ({ path: args.path.split("/").pop(), namespace: "swapped" }));
    build.onLoad({ filter: /.*/, namespace: "swapped" }, (args) => ({ contents: "module.exports = " + JSON.stringify("plugin " + args.path), loader: "js" }));
  },
});
