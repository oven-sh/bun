// b.cjs requires a.mjs, and a.mjs calls import("./b.cjs"). Where b.cjs overtook a.mjs, that call came while b.cjs ran, and the namespace object got the names that b.cjs had exported
// by then: none.
// Reference: bun build --compile
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const [a, b] = await Promise.all([import("./a.mjs"), import("./b.cjs")]);
console.log(
  "keys " +
    (m =>
      Object.keys(m)
        .filter(k => k !== "module.exports" && k !== "__esModule")
        .sort())(b) +
    " " +
    b.fromB,
);
