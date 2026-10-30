// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const name = ["m", "a", "p"].join("");
console.log([1, 2][name](n => n * 2).length);
