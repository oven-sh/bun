// The reference is `bun <file>`: `bun build --compile` stops at an import() outside a `try` whose name it does not find.
Bun.plugin({
  name: "made",
  setup(build) {
    build.onResolve({ filter: /^(virtual:thing|kit-that-is-missing|kit-that-is-missing\/sub|\.\/missing\.mjs|\.\/missing)$/ }, (args) => ({ path: args.path, namespace: "made" }));
    build.onLoad({ filter: /.*/, namespace: "made" }, (args) => ({ exports: { default: "made " + args.path, a: 1 }, loader: "object" }));
  },
});
const attempt = async (run) => {
  try {
    return (await run()).default;
  } catch (error) {
    return "failed " + error.name + " " + error.code;
  }
};
console.log(await attempt(() => import("./missing.mjs")));
console.log(await attempt(() => import("./missing")));
console.log(await attempt(() => import("kit-that-is-missing/sub")));
console.log(await attempt(() => import(`virtual:thing`)));
console.log(await attempt(() => import("virtual:" + "thing")));
console.log(await attempt(() => import("nobody:answers")));
import("virtual:thing").then((got) => console.log("then", got.default, got.a));
const first = await import("virtual:thing"), second = await import("virtual:thing");
console.log(first === second, Object.keys(first).join());
