// Nothing else in the program names node:dgram.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const { require: r } = import.meta;
let answer;
try { answer = typeof (r("node:dgram"))?.createSocket; } catch (error) { answer = error.code; }
console.log(answer);
