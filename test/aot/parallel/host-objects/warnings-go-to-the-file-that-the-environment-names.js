// Where there is such a file the warnings are appended to it, so they are printed here. Elsewhere it cannot be opened and they go to the standard error.
// Env: NODE_REDIRECT_WARNINGS=/dev/stdout
// STATISTIC: ImageFunctionsEmitted <= 70
Object.defineProperty(process, "pid", { value: 1 });
process.argv0 = "/somewhere/else//a tool//";
process.emitWarning("first");
process.emitWarning("second", "CustomWarning", "CODE1");
process.emitWarning(new RangeError("third"));
process.emitWarning("fourth", { type: "DetailWarning", detail: "more\nlines \u{1F600} \uD800" });
