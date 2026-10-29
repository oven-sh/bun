// The parent of a commonjs file that a module imports and other files require later.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
// Alone: it asks which file the executable was started as (import.meta.main, require.main, module.id, module.parent, process.argv[1])
import * as first from "./first.cjs";
import * as second from "./second.cjs";
import * as third from "./third.cjs";
import * as ring from "./ring-3.cjs";
import * as pair from "./pair-x.cjs";
console.log("first", first.parent());
console.log("second", second.early, second.parent());
console.log("third", third.parent(), third.children());
console.log("ring", ring.early, ring.late, ring.kind, ring.below);
console.log("pair", pair.early, pair.late, pair.other);
