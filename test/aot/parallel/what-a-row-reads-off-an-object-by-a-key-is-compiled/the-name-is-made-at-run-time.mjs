// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const unseen = value => [value][JSON.parse("0")];
console.log(Reflect.get([], unseen("flat") + unseen("Map")).call([1], count => [count, count]).join());
