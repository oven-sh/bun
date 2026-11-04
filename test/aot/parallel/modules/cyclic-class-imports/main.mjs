// Reference: bun build --compile
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const [derived, base] = await Promise.all([import("./derived.mjs"), import("./base.mjs")]);
console.log(new derived.Derived().hi(), base.make().hi());
