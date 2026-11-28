Bun.plugin({
  name: "replaces os",
  setup(build) {
    build.onResolve({ filter: /^os$/, namespace: "node" }, () => ({ path: __dirname + "/os.cjs" }));
  },
});
