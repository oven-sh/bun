// Nothing else in the program names node:dgram.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { load } from "./elsewhere.mjs";
let answer;
try { answer = typeof (load("node:dgram"))?.createSocket; } catch (error) { answer = error.code; }
console.log(answer);
