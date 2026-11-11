// The program does not write the name, and nothing else names the module: the executable holds it all the same, compiled, and finds it as `bun <file>` does.
// Env: NAME_OF_MODULE=node:dgram
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
let answer;
try { answer = typeof (require(process.env.NAME_OF_MODULE))?.createSocket; } catch (error) { answer = error.code; }
console.log(answer);
