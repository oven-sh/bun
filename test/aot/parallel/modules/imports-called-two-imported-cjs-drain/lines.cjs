globalThis.lines = [];
process.on("uncaughtException", error => lines.push("uncaught " + error.message));
process.on("exit", () => console.log(lines.sort().join("\n")));
module.exports = {};
