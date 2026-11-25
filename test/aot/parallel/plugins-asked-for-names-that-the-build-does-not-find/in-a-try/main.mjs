Bun.plugin({
  name: "made",
  setup(build) {
    build.onResolve({ filter: /^(virtual:thing|kit-that-is-missing|kit-that-is-missing\/sub|\.\/missing\.mjs|\.\/missing)$/ }, (args) => ({ path: args.path, namespace: "made" }));
    build.onLoad({ filter: /.*/, namespace: "made" }, (args) => ({ exports: { default: "made " + args.path, a: 1 }, loader: "object" }));
  },
});
try {
  console.log((await import("virtual:thing")).default);
} catch (error) {
  console.log("failed", error.name, error.code);
}
try {
  console.log((await import("kit-that-is-missing")).default);
} catch (error) {
  console.log("failed", error.name, error.code);
}
