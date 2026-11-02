// Nothing else in the program names node:dgram.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { createRequire } from "node:module";
let r;
function load(n) { r ??= createRequire(import.meta.url); return r(n); }
let answer;
try { answer = typeof (load("node:dgram"))?.createSocket; } catch (error) { answer = error.code; }
console.log(answer);
