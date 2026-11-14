// As esbuild's lib/main.js has it: the module lies in a variable that is assigned in a try, and the function that starts the Worker is handed it. The file starts itself and is no entry point.
// Nobody follows the module to `given`, so the `new` was no start of a Worker: Cannot load '/$bunfs/root/lib/starts-itself.cjs': this executable can't load a module from a dynamic path.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const worker = require("./lib/starts-itself.cjs").start();
worker.on("message", text => (console.log(text), worker.terminate()));
worker.on("error", () => console.log("error"));
