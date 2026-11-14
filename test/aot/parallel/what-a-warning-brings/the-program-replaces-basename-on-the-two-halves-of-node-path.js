// The program names node:path/posix and node:path/win32 alone: what it lays there is what node:path holds.
// Env: NODE_REDIRECT_WARNINGS=/dev/stdout
require("node:path/posix").basename = require("node:path/win32").basename = () => "REPLACED";
Object.defineProperty(process, "pid", { value: 1 });
process.on("uncaughtException", error => console.log("CAUGHT", error.name, error.code, error.message));
process.argv0 = 5;
process.emitWarning("made up");
