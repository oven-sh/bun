// b.cjs is the root of one load and what a statement names in another: it runs before its names are taken.
// Reference: bun build --compile
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const all = await Promise.allSettled([import("./a.mjs"), import("./b.cjs")]);
for (const one of all)
  console.log(
    one.status +
      " " +
      (one.reason
        ? one.reason.name
        : (m =>
            Object.keys(m)
              .filter(k => k !== "module.exports" && k !== "__esModule")
              .sort())(one.value)),
  );
console.log("later " + later());
