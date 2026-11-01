// Two calls of import() in one turn, and both files import s.mjs. `bun run` hears of the text of s.mjs once, and it is the last text of both graphs: both run in its turn, and then both calls go on.
// The texts are read at once, on other threads: not every run of `bun run` prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
// COUNT: counter:CompiledModulesWalkedByLoader = 0
import("./a.mjs").then(() => console.log("a settled"));
import("./b.mjs").then(() => console.log("b settled"));
/* Output:
s runs
a runs
b runs
a settled
b settled
*/
