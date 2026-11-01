// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
process.emitWarning("said", "CustomWarning", "W1");
await new Promise(resolve => setTimeout(resolve, 20));
console.log("done");
