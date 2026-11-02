// Nothing else in the program names node:dgram.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { ask } from "./elsewhere.mjs";
let answer;
try { answer = typeof (ask("node:dgram"))?.createSocket; } catch (error) { answer = error.code; }
console.log(answer);
