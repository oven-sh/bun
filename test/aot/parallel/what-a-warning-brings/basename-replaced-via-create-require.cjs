// The program reaches node:path through a require() that node:module created.
// Env: NODE_REDIRECT_WARNINGS=/dev/stdout
require("node:module").createRequire(__filename)("path").basename = () => "REPLACED";
Object.defineProperty(process, "pid", { value: 1 });
process.on("uncaughtException", error => console.log("CAUGHT", error.name, error.code, error.message));
process.argv0 = 5;
process.emitWarning("made up");
