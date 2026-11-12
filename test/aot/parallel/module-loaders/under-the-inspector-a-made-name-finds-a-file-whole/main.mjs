// Under --compile-inspector the run time refuses no file of the program to a name made at run time. The build left out what nothing written reads all the same:
// require() of a file of which one export is used answered undefined, import() a namespace without the other export, and a file named only in a function that nothing calls was not there.
// Flags: --compile-inspector
import { createRequire } from "node:module";
import { used } from "./imported.mjs";
const require = createRequire(import.meta.url);
const { used: required } = require("./required.cjs");
function never() {
  return require("./never.cjs");
}
const made = word => JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? JSON.stringify("./" + word));
console.log(used(1), typeof (await import(made("imported.mjs"))).unused);
console.log(required(1), typeof require(made("required.cjs")).unused);
console.log(require(made("never.cjs")).who);
