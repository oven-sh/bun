// A later require of a commonjs file marked as an es module that threw behind a graph that imports it.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import "./late.cjs";
import value, { first } from "./file.cjs";
console.log("main begins", typeof value, first);
await 0;
console.log("main ends");
