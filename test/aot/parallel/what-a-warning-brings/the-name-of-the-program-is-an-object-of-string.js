// The function that stands under path.basename() takes an object of String for a text.
// Env: NODE_REDIRECT_WARNINGS=/dev/stdout
Object.defineProperty(process, "pid", { value: 1 });
process.on("uncaughtException", error => console.log("CAUGHT", error.name, error.code, error.message));
process.argv0 = new String("/somewhere/a tool");
process.emitWarning("made up");
