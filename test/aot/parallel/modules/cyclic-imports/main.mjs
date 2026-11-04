// Reference: bun build --compile
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const [a, b] = await Promise.all([import("./a.mjs"), import("./b.mjs")]);
console.log(a.fromA, b.later());
