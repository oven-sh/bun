// A program that names "bun:wrap" only by names computed at run time: the build sees nobody who names the module, so it is not in the executable. Every loader refuses it as it refuses any other module of Bun's that was left out, and nothing is interpreted.
// Env: BUN_JSC_crashIfInterpreterIsUsed=1
import { createRequire } from "node:module";
const name = "bun:" + "wr ap".split(" ").join("");
async function attempt(what, load) {
  try {
    console.log(what, typeof (await load()).__toESM);
  } catch (error) {
    console.log(what, error.code, error instanceof Error);
  }
}
await attempt("import()", () => import(name));
await attempt("import.meta.require()", () => import.meta.require(name));
await attempt("createRequire()()", () => createRequire(import.meta.url)(name));
console.log("in require.cache:", Object.keys(createRequire(import.meta.url).cache).filter(key => /^bun:wrap$|prelude/.test(key)).length);
console.log("went on");
/* Output:
import() ERR_MODULE_NOT_FOUND true
import.meta.require() MODULE_NOT_FOUND true
createRequire()() MODULE_NOT_FOUND true
in require.cache: 0
went on
*/
