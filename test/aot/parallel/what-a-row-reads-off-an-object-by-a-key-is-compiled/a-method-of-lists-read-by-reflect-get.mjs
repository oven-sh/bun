// Reflect.get finds Array.prototype.map above the list. The function that it hands back is compiled: nothing here runs in the interpreter, and little more comes along than that one function.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// STATISTIC: ImageFunctionsEmitted <= 16
console.log(Reflect.get([], "map").call([1], count => count + 1).join());
