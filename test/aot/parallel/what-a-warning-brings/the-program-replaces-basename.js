// A program name that is not a string is passed to path.basename(), which the program has replaced.
// Env: NODE_REDIRECT_WARNINGS=/dev/stdout
const path = require("node:path");
path.basename = path.posix.basename = path.win32.basename = () => "REPLACED";
Object.defineProperty(process, "pid", { value: 1 });
process.on("uncaughtException", error => console.log("CAUGHT", error.name, error.code, error.message));
process.argv0 = 5;
process.emitWarning("made up");
