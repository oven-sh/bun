// Reference: bun build --compile
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
// Todo: two calls in flight that share a module are handed to the loader, which walks compiled modules
// COUNT: counter:CompiledModulesWalkedByLoader = 0
// Two calls of import() in one turn, and both files import s.mjs: both graphs run, and then both calls go on. shared-import asks for the lines alone.
import("./a.mjs").then(() => console.log("a settled"));
import("./b.mjs").then(() => console.log("b settled"));
