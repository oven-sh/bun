process.on("uncaughtException", error => console.log("nobody catches", error.name));
process.on("exit", code => console.log("the end", code));
console.log("the file runs");
if (globalThis.never) exports.one = 1;
