// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const read = (0, eval)("(list, name) => Reflect.get(list, name)");
console.log(read([], "findLast").call([1, 2, 3], count => count < 3));
