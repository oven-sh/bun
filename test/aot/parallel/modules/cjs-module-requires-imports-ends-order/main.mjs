// A commonjs file that a module it requires imports ends in order and is required later.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import "./late.cjs";
import { first } from "./file.cjs";
console.log("main runs", first);
