// An object of String is not a text to path.basename().
// Env: NODE_REDIRECT_WARNINGS=/dev/stdout
Object.defineProperty(process, "pid", { value: 1 });
process.on("uncaughtException", error => console.log("CAUGHT", error.name, error.code, error.message));
process.argv0 = new String("/somewhere/a tool");
process.emitWarning("made up");
