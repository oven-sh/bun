// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
process.nextTick((...all) => console.log("tick", ...all), 1, 2, 3, 4, 5);
console.log("first");
