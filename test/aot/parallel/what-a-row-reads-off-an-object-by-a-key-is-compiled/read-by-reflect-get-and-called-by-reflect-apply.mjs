// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// STATISTIC: ImageFunctionsEmitted <= 16
const map = Reflect.get([1, 2, 3], "map");
console.log(Reflect.apply(map, [1, 2, 3], [count => count * 2]).join());
