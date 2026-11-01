// Nothing else in the program names node:dgram.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const list = ["node:dgram"];
const names = new Set(list);
let answer;
try { answer = typeof (list.includes("node:dgram") && process.getBuiltinModule([...names][0]))?.createSocket; } catch (error) { answer = error.code; }
console.log(answer);
