// Create require is assigned on one require of node module and called on the next.
try { require("node:module").createRequire = () => name => console.log("mine", name); } catch (error) { console.log(String(error)); } require("node:module").createRequire(__filename)("./next.cjs");
/* Output:
TypeError: Cannot assign to node:module.createRequire because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
the next file
*/
