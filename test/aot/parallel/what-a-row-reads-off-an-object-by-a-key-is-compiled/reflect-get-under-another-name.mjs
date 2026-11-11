// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// STATISTIC: ImageFunctionsEmitted <= 16
const read = Reflect.get;
console.log(read([], "filter").call([1, 2, 3], count => count > 1).join());
