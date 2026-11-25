// The program reaches node:path through an import() whose specifier is computed at run time.
// Env: NODE_REDIRECT_WARNINGS=/dev/stdout
const name = ["node", "path"].join(":");
(await import(name)).default.basename = () => "REPLACED";
Object.defineProperty(process, "pid", { value: 1 });
process.on("uncaughtException", error => console.log("CAUGHT", error.name, error.code, error.message));
process.argv0 = 5;
process.emitWarning("made up");
