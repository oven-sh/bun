// Nothing else in the program names node:dgram.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
function f(p) { return p.getBuiltinModule("node:dgram"); }
let answer;
try { answer = typeof (f(process))?.createSocket; } catch (error) { answer = error.code; }
console.log(answer);
