// An ES module replaces basename() on the default export of node:path.
// Env: NODE_REDIRECT_WARNINGS=/dev/stdout
import path from "node:path";
path.basename = () => "REPLACED";
Object.defineProperty(process, "pid", { value: 1 });
process.on("uncaughtException", error => console.log("CAUGHT", error.name, error.code, error.message));
process.argv0 = 5;
process.emitWarning("made up");
