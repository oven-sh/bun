// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const { map } = Array.prototype;
console.log(Reflect.apply(map, [1, 2], [n => n * 2]).length);
