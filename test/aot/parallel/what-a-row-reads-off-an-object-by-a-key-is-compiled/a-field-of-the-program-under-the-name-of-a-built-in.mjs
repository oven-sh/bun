// The object has the name itself. What the read gives is the field.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// STATISTIC: ImageFunctionsEmitted <= 24
console.log(Reflect.get({ map: 5 }, "map"), Reflect.get([7, 8], 1), Reflect.get([7, 8], "length"), Reflect.get([], "no-such-name"));
