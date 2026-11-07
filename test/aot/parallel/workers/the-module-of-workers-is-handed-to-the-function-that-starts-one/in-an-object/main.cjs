// The module goes to the function in an object, and the file of the Worker is another one, joined to `__dirname`.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const worker = require("./lib/pool.cjs").start();
worker.on("message", text => (console.log(text), worker.terminate()));
worker.on("error", () => console.log("error"));
