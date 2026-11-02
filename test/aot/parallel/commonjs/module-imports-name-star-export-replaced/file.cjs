process.on("uncaughtException", error => console.log("nobody catches", error.name));
process.on("exit", code => console.log("the end", code));
console.log("the file runs");
exports.one = 1;
module.exports = { two: 2 };
