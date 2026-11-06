// An uncaught read of a missing name.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// Exit code: 1
function read() { return nowhere; }
console.log("before");
read();
console.log("after");
