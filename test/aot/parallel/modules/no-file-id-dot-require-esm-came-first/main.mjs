// No file has the id dot where a require of an es module came before the first import of a commonjs file.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
// Alone: it asks which file the executable was started as (import.meta.main, require.main, module.id, module.parent, process.argv[1])
import.meta.require("./required.mjs");
await import("./late.cjs");
