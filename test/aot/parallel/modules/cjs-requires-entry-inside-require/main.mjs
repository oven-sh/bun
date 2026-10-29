// A commonjs file requires the entry point inside a require of another graph.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import "./first.cjs";
import { name } from "./beside.mjs";
console.log("main runs beside", name);
export const answer = 42;
