// Module of node module is assigned an object with a create require.
const M = require("node:module"); try { M.Module = { createRequire: () => name => console.log("mine", name) }; } catch (error) { console.log(String(error)); } M.Module.createRequire(__filename)("./next.cjs");
/* Output:
TypeError: Cannot assign to node:module.Module because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
the next file
*/
