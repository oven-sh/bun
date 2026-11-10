// process.getBuiltinModule() is the only way this program reaches node:path.
// Env: NODE_REDIRECT_WARNINGS=/dev/stdout
process.getBuiltinModule("node:path").basename = () => "REPLACED";
Object.defineProperty(process, "pid", { value: 1 });
process.on("uncaughtException", error => console.log("CAUGHT", error.name, error.code, error.message));
process.argv0 = 5;
process.emitWarning("made up");
