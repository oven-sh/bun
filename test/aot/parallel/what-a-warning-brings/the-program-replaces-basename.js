// For a name that is no text the printer asks the native basename, which throws: what the program has stored under the name is not asked.
// Env: NODE_REDIRECT_WARNINGS=/dev/stdout
const path = require("node:path");
path.basename = path.posix.basename = path.win32.basename = () => "REPLACED";
Object.defineProperty(process, "pid", { value: 1 });
process.on("uncaughtException", error => console.log("CAUGHT", error.name, error.code, error.message));
process.argv0 = 5;
process.emitWarning("made up");
