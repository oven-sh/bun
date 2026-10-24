process.on("uncaughtException", error => console.log("nobody catches", error.name));
process.on("exit", code => console.log("the end", code));

globalThis.ran ??= [];
console.log("the file begins");
require("./main.mjs");
exports.count = 1;
