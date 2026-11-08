// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log(Reflect.get(Array.prototype, "map").call([1], count => count + 1).join(), Object.getPrototypeOf([]).some.call([1], count => count > 0));
