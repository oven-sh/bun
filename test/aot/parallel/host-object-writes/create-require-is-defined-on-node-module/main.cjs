Object.defineProperty(require("node:module"), "createRequire", { value: () => name => console.log("mine", name) }); require("node:module").createRequire(__filename)("./next.cjs");
/* Build errors:
error: TS100014: this assignment always throws: built-in objects are read-only in a compiled executable
*/
