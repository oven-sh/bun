// require() of "bun:wrap" by a name computed at run time, in a CommonJS file that never names the module: it is not in the executable, and require() refuses it as it refuses any other module of Bun's that was left out. Nothing is interpreted.
// Env: BUN_JSC_crashIfInterpreterIsUsed=1
const name = "bun:" + "wr ap".split(" ").join("");
for (let round = 0; round < 2; round++) {
  try {
    console.log(typeof require(name).__toESM);
  } catch (error) {
    console.log(error.code, error instanceof Error);
  }
}
console.log("in require.cache:", Object.keys(require.cache).filter(key => /^bun:wrap$|prelude/.test(key)).length);
console.log("went on");
/* Output:
MODULE_NOT_FOUND true
MODULE_NOT_FOUND true
in require.cache: 0
went on
*/
