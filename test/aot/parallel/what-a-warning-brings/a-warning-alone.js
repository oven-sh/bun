// Where there is such a file the warnings are appended to it, so they are printed here. Elsewhere it cannot be opened and they go to the standard error.
// Env: NODE_REDIRECT_WARNINGS=/dev/stdout
// STATISTIC: ImageFunctionsEmitted <= 60
Object.defineProperty(process, "pid", { value: 1 });
process.argv0 = "/somewhere/a tool";
process.emitWarning("made up");
