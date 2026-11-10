// The replaced path.basename() is called as a method of node:path, with the program name as its only argument.
// Env: NODE_REDIRECT_WARNINGS=/dev/stdout
const path = require("node:path");
path.basename = function (...args) {
  return `${this === path} ${args.length} ${typeof args[0]}`;
};
Object.defineProperty(process, "pid", { value: 1 });
process.on("uncaughtException", error => console.log("CAUGHT", error.name, error.code, error.message));
process.argv0 = 5;
process.emitWarning("made up");
