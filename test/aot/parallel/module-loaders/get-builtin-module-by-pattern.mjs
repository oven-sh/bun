// Nothing else in the program names node:dgram.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const { getBuiltinModule } = process;
let answer;
try { answer = typeof (getBuiltinModule("node:dgram"))?.createSocket; } catch (error) { answer = error.code; }
console.log(answer);
