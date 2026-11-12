// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const addOne = [].map.bind([1, 2]);
console.log(addOne(count => count + 1).join());
