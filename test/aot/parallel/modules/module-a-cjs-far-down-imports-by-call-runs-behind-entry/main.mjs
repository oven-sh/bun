// As its neighbor file-an-imported-cjs-.., two modules further down, by each kind of import statement, and what import() names is an ES module.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
import * as upper from "./upper.mjs";
console.log("main", upper.name);
await 0;
console.log("main behind an await");
