// Nothing else in the program names node:dgram.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
let answer;
try { answer = typeof (require("module").prototype.require.call(module, "node:dgram"))?.createSocket; } catch (error) { answer = error.code; }
console.log(answer);
