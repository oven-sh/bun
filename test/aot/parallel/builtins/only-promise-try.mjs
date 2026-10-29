// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log(await Promise.try(n => n * 2, 21));
