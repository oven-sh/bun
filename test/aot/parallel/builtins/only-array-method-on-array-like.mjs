// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log(Array.prototype.map.call({ length: 2, 0: "a", 1: "b" }, s => s + s).join());
