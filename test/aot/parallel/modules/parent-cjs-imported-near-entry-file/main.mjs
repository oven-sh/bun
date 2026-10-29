// The parent of a commonjs file that is imported as near to the entry point as the file that requires it.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
// Alone: it asks which file the executable was started as (import.meta.main, require.main, module.id, module.parent, process.argv[1])
import "./first.cjs";
import * as a from "./a.cjs";
import * as b from "./b.cjs";
import "./x.mjs";
import * as c from "./c.cjs";
import "./f.cjs";
export * from "./g.cjs";
import "./two-below.mjs";
console.log("main", a.parent(), b.parent(), c.parent());
