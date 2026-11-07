// The printer names the program in its second line. A name that is no text goes to the function that stands under path.basename(), which refuses it in its own words.
// The module node:path is not loaded for that: Object lists what is read off it in the order of the reads, and the module reads three members.
// Env: NODE_REDIRECT_WARNINGS=/dev/stdout
Object.defineProperty(process, "pid", { value: 1 });
process.on("uncaughtException", error => console.log("CAUGHT", error.name, error.code, error.message));
process.argv0 = 5;
process.emitWarning("made up");
setImmediate(() => console.log(Object.getOwnPropertyNames(Object).join()));
