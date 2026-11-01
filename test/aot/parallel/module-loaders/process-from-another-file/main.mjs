// Nothing else in the program names node:dgram.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { held } from "./elsewhere.mjs";
let answer;
try { answer = typeof (held.getBuiltinModule("node:dgram"))?.createSocket; } catch (error) { answer = error.code; }
console.log(answer);
