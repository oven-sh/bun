// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
// As the file ENV beside this one says: the program is held to `bun <file>` on one thread, where the texts of a ring of modules arrive in the order in which they are asked for.
import "node:path";
import d from "./lib.cjs";
import * as n from "./lib.cjs";
console.log("main runs", d === n.default, JSON.stringify(d), JSON.stringify(n.default));
setTimeout(() => console.log("later", d === n.default, JSON.stringify(d), JSON.stringify(n.default)));
