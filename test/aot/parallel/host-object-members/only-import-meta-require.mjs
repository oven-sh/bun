// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log(typeof import.meta.require("node:path").join);
