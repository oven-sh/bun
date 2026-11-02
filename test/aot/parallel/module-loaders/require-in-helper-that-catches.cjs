// Nothing else in the program names node:dgram.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
function tryRequire(n) { try { return require(n); } catch { return null; } }
let answer;
try { answer = typeof (tryRequire("node:dgram"))?.createSocket; } catch (error) { answer = error.code; }
console.log(answer);
