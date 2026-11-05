// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log(Uint8Array.from([1, 2], n => n * 2).length, Uint8Array.from(new Set([5]))[0]);
