// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// STATISTIC: ImageFunctionsEmitted <= 16
const prices = new Map([["tea", 2], ["milk", 3]]);
Reflect.get(prices, "forEach").call(prices, (price, name) => console.log(name, price));
