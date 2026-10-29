// A later require of a commonjs file that exports a class and threw behind a graph that imports it.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import "./late.cjs";
import Thing from "./file.cjs";
console.log("main begins", typeof Thing);
await 0;
console.log("main ends");
