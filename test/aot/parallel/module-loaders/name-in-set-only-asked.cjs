// A text in a set that is only asked comes to no loader and keeps no module.
// Env: NAME_OF_MODULE=node:dgram
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const names = new Set(["node:dgram"]);
if (names.has(process.env.NAME_OF_MODULE) && names.size === 1) console.log("asked");
let answer;
try { answer = typeof (require(process.env.NAME_OF_MODULE))?.createSocket; } catch (error) { answer = error.code; }
console.log(answer);
/* Output:
asked
MODULE_NOT_FOUND
*/
