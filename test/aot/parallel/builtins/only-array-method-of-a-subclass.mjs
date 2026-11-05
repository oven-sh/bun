// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
class List extends Array {}
console.log(List.from([1, 2]).map(n => n * 2) instanceof List, new List(1, 2, 3).filter(n => n > 1).length);
