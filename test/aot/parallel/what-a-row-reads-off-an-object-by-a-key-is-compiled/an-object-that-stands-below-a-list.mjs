// The list is the prototype of the object that is asked.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const shelf = { __proto__: [] };
console.log(Reflect.get(shelf, "map").call([1], count => count + 1).join());
