Bun.plugin({
  name: "replaces os",
  setup(build) {
    build.onResolve({ filter: /^os$/, namespace: "node" }, ({ path }) => ({ path, namespace: "shim" }));
    build.onLoad({ filter: /.*/, namespace: "shim" }, async () => {
      await 0;
      const os = await import("os");
      return { exports: { from: typeof os.arch + typeof require("os").arch }, loader: "object" };
    });
  },
});
