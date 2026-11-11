// The second line of the first warning names the program. A name that is not a string is passed to path.basename(), which throws.
// Plain Bun loads node:path for that. Object lists a member from when it is first read, and the module reads three members when it loads.
// Env: NODE_REDIRECT_WARNINGS=/dev/stdout
Object.defineProperty(process, "pid", { value: 1 });
process.on("uncaughtException", error => console.log("CAUGHT", error.name, error.code, error.message));
process.argv0 = 5;
process.emitWarning("made up");
setImmediate(() => console.log(Object.getOwnPropertyNames(Object).join()));
