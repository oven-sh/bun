// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
clearTimeout(setTimeout(() => {}, 2 ** 31));
await new Promise(resolve => setTimeout(resolve, 20));
console.log("done");
