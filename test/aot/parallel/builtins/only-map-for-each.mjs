// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
new Map([["a", 1]]).forEach((value, key) => console.log(key, value));
