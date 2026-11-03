// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log(require("./other.cjs").value, typeof require, typeof module.require);
