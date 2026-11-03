// Nothing else in the program names node:dgram.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const names = { d: "node:dgram" };
let answer;
try { answer = typeof (process.getBuiltinModule(names.d))?.createSocket; } catch (error) { answer = error.code; }
console.log(answer);
