// A later require of an imported commonjs file that threw behind a graph that imports it.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import "./late.cjs";
import "./file.cjs";
console.log("main begins");
await 0;
console.log("main ends");
