// A flag that a CommonJS file exports is false, or another text than the one asked for, on every run. What stands behind the test is not loaded and is not in the executable.
// STATISTIC: ImageFunctionsEmitted <= 2
import { DEBUG } from "./stores.cjs";
import { mode } from "./untyped.mjs";
if (DEBUG) require("./unused-by-import");
if (require("./stores.cjs").VERBOSE) require("./unused-by-member");
const { TRACE } = require("./literal.cjs");
if (TRACE) require("./unused-by-pattern");
console.log(DEBUG, mode, TRACE);
