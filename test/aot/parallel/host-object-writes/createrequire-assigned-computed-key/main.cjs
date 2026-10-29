// Create require is assigned under a key put together at run time.
const key = ["create", "Require"].join(""); try { require("node:module")[key] = () => name => console.log("mine", name); } catch (error) { console.log(String(error)); } require("node:module").createRequire(__filename)("./next.cjs");
/* Output:
TypeError: Cannot assign to node:module.createRequire because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
the next file
*/
