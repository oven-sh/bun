// Reference: bun build --compile
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const all = await Promise.all([import("./r1.mjs"), import("./r2.mjs"), import("./r3.mjs")]);
console.log(all.map(it => it.v).join());
