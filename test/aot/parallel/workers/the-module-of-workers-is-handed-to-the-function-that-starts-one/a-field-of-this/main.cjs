// The module is kept in a field.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const worker = require("./lib/pool.cjs").start();
worker.on("message", text => (console.log(text), worker.terminate()));
worker.on("error", () => console.log("error"));
