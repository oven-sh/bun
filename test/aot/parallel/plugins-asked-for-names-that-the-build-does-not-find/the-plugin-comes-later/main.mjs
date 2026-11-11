// The reference is `bun <file>`: `bun build --compile` stops at an import() outside a `try` whose name it does not find.
const attempt = async (run) => {
  try {
    return (await run()).default;
  } catch (error) {
    return "failed " + error.name + " " + error.code;
  }
};
const load = () => import("virtual:thing");
console.log(await attempt(load));
Bun.plugin({
  name: "made",
  setup(build) {
    build.onResolve({ filter: /^virtual:thing$/ }, (args) => ({ path: args.path, namespace: "made" }));
    build.onLoad({ filter: /.*/, namespace: "made" }, (args) => ({ exports: { default: "made " + args.path }, loader: "object" }));
  },
});
console.log(await attempt(load));
console.log(await attempt(load));
