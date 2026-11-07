// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log([]["map"].call([1], count => count + 1).join(), new Map([[1, 2]])["forEach"].name);
