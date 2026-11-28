Bun.plugin({
  name: "replaces os",
  setup(build) {
    build.onResolve({ filter: /^os$/, namespace: "node" }, ({ path }) => ({ path, namespace: "shim" }));
    build.onLoad({ filter: /.*/, namespace: "shim" }, () => ({ exports: { join: "plugin" }, loader: "object" }));
  },
});
