// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log(Iterator.zipKeyed({ a: [1], b: [2] }).next().value.b);
