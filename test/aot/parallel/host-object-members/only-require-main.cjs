// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log(require.main === module, typeof require.main);
