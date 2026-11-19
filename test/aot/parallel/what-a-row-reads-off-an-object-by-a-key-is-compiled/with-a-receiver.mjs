// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// STATISTIC: ImageFunctionsEmitted <= 16
console.log(Reflect.get([], "map", [4]).call([1], count => count + 1).join());
