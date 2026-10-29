// Create require is assigned on the default of the namespace of node module.
import * as ns from "node:module"; ns.default.createRequire = () => name => console.log("mine", name); ns.createRequire(import.meta.url)("./next.mjs");
/* Build errors:
error: TS100014: this assignment always throws: built-in objects are read-only in a compiled executable
*/
