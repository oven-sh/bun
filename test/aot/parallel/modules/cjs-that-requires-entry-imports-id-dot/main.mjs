// A commonjs file that requires the entry point that imports it has the id dot.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
// Alone: it asks which file the executable was started as (import.meta.main, require.main, module.id, module.parent, process.argv[1])
import file, { second } from "./file.cjs";
import * as all from "./file.cjs";
export const own = "of main";
console.log("main", file.first, second, Object.keys(all).join());
