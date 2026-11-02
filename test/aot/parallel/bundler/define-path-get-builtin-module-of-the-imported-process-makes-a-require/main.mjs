// A call of a name whose `--define` value is `getBuiltinModule` of the `process` that the file imports answers with the module of `createRequire`: the build finds the file that the made `require` loads.
// Flags: --define GBM=process.getBuiltinModule
import process from "node:process";
const { createRequire } = GBM("node:module");
const require = createRequire(import.meta.url);
console.log(require("./lib.cjs").name);
