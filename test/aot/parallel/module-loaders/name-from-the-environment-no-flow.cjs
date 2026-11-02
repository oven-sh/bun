// The program does not write the name of the module. Built without whole-program analysis, the executable holds the whole library, compiled.
// Flags: --aot-disable=flow-results
// Env: NAME_OF_MODULE=node:dgram
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
let answer;
try {
  answer = typeof require(process.env.NAME_OF_MODULE)?.createSocket;
} catch (error) {
  answer = error.code;
}
console.log(answer);
