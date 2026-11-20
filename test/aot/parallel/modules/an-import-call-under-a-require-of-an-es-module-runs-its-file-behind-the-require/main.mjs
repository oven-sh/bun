// An import() that is called while a require() loads an ES module is no part of what the require() loads: the file that it names runs after the require() has returned, as in Node.js. `bun run` and `bun build --compile` run it inside the require().
// The call stands in the module that is required, and in a CommonJS file that the required module imports.
// docs/compiler/compatibility.mdx, "Loader hooks and the module cache". Plain Bun prints another output.
import { createRequire } from "node:module";
const load = createRequire(import.meta.url);
console.log("main: required", Object.keys(load("./calls.mjs")).join());
console.log("main: required", Object.keys(load("./imports-a-file-that-calls.mjs")).join());
console.log("main ends");
/* Output:
calls.mjs runs
main: required first
file.cjs runs
imports-a-file-that-calls.mjs runs value
main: required second
main ends
asked-by-the-module.mjs runs
asked-by-the-file.mjs runs
*/
