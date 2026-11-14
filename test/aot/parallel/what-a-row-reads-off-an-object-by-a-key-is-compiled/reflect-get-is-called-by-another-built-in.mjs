// Reflect.apply and reduce call Reflect.get: no call of it stands in the text.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log(Reflect.apply(Reflect.get, null, [[], "map"]).call([1], count => count + 1).join());
console.log([[], "every"].reduce(Reflect.get).call([1], count => count > 0));
