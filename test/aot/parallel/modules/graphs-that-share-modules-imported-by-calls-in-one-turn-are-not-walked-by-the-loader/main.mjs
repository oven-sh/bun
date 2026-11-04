// Reference: bun build --compile
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
// Todo: two calls in flight that share a module are handed to the loader, which walks compiled modules
// COUNT: counter:CompiledModulesWalkedByLoader = 0
Promise.all([import("./a-1.mjs"), import("./b-1.mjs"), import("./c-1.mjs")]).then(() => console.log(globalThis.ran));
