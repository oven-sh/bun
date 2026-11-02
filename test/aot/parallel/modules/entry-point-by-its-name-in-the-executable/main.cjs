// A further entry point is found by the name it has in the executable, from the folder of the file that asks.
// Entry points: ./plugins/a.cjs
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log(require(["./plugins/a", ".js"].join("")).name, require("./lib/loader.cjs").load("../plugins/a.js").name);
/* Output:
a a
*/
