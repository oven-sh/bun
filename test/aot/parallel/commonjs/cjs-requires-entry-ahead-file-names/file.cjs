// Which module runs first is not told: the lines are sorted.
process.on("exit", code => console.log([...globalThis.ran].sort().join("\n") + "\nthe end " + code));

(globalThis.ran ??= []).push("file");
exports.count = 1;
console.log("the file sees", Object.keys(require("./main.mjs")).join());
