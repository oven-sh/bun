// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const described = Object.getOwnPropertyDescriptor(Object.getPrototypeOf([]), "filter");
console.log(described.value.call([1, 2, 3], count => count > 1).join());
console.log(Object.getOwnPropertyDescriptors(Array.prototype).flatMap.value.call([1], count => [count, count]).join());
