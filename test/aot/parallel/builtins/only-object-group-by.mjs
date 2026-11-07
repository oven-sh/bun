// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log(Object.groupBy([1, 2, 3], n => (n % 2 ? "odd" : "even")).odd.length);
