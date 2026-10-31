// Nothing else in the program names node:dgram.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import * as p from "node:process";
let answer;
try { answer = typeof (p.getBuiltinModule("node:dgram"))?.createSocket; } catch (error) { answer = error.code; }
console.log(answer);
