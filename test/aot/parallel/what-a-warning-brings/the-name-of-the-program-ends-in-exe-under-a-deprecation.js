// The second line of the first warning names the flag for the kind of that warning, and the program without its ".exe". A warning that follows has no second line.
// Env: NODE_REDIRECT_WARNINGS=/dev/stdout
Object.defineProperty(process, "pid", { value: 1 });
process.argv0 = "/somewhere/a tool.exe";
process.emitWarning("made up", "DeprecationWarning");
process.emitWarning("made up too");
