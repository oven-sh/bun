// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
// COUNT: counter:CompiledModulesWalkedByLoader = 0
Promise.all([import("./a-1.mjs"), import("./b-1.mjs"), import("./c-1.mjs")]).then(() => console.log(globalThis.ran));
