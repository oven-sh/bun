// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const { map, filter } = [];
console.log(map.call([1, 2], count => count + 1).join(), filter.call([1, 2], count => count > 1).join());
