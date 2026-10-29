// The program does not write the name, and nothing else names the module: the executable does not hold it.
// Env: NAME_OF_MODULE=node:dgram
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
let answer;
try { answer = typeof (require(process.env.NAME_OF_MODULE))?.createSocket; } catch (error) { answer = error.code; }
console.log(answer);
/* Output:
MODULE_NOT_FOUND
*/
