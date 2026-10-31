// Create require is assigned on the default import of node module.
import M from "node:module"; M.createRequire = () => name => console.log("mine", name); M.createRequire(import.meta.url)("./next.mjs");
/* Build errors:
error: TS100014: this assignment always throws: built-in objects are read-only in a compiled executable
*/
