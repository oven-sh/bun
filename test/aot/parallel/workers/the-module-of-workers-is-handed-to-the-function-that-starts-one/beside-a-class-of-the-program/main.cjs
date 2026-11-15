// A class of the program's own goes by the same name in the same file. What it is given names no file, so it adds nothing.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const worker = require("./lib/both.cjs").start();
worker.on("message", text => (console.log(text), worker.terminate()));
worker.on("error", () => console.log("error"));
