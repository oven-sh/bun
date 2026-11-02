// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const copy = { ...setTimeout };
const [custom] = Object.getOwnPropertySymbols(copy);
console.log(String(custom), await copy[custom](1, "spread"));
