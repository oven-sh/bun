// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// STATISTIC: ImageFunctionsEmitted <= 16
const prices = new Map([["tea", 2]]);
console.log(prices.__lookupGetter__("size").call(prices), Reflect.get(prices, "size"));
