// Nothing else in the program names node:dgram.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const { createRequire } = await import("node:module");
const r = createRequire(import.meta.url);
let answer;
try { answer = typeof (r("node:dgram"))?.createSocket; } catch (error) { answer = error.code; }
console.log(answer);
