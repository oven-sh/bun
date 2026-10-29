// Create require is assigned on what get builtin module answers.
process.getBuiltinModule("node:module").createRequire = () => name => console.log("mine", name); process.getBuiltinModule("node:module").createRequire(import.meta.url)("./next.mjs");
/* Build errors:
error: TS100014: this assignment always throws: built-in objects are read-only in a compiled executable
*/
