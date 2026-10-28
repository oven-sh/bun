// The arm that a `const` of another file rules out names built-in modules. Nothing of them is compiled.
// STATISTIC: FunctionsLowered <= 1200
import { debug } from "./flags.js";
import * as flags from "./flags.js";
if (debug) console.log(require("node:http").STATUS_CODES);
if (flags.debug) console.log((await import("node:https")).globalAgent);
export function serve() {
  return debug ? require("node:net").createServer() : null;
}
console.log("done", serve());
