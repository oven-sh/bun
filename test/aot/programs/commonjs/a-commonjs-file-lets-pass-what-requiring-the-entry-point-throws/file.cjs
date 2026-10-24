const told = error => `${error?.name}: ${error?.message.replace(/'[^']*[\\/]/, "'")}`;
process.on("uncaughtException", error => console.log("nobody catches", told(error)));
process.on("exit", code => console.log("the end", code));

console.log("the file begins");
exports.first = 1;
console.log("required", Object.keys(require("./main.mjs")).join());
exports.second = 2;
console.log("the file ends");
