const told = error => `${error.name}: ${error.message.replace(/'[^']*[\\/]/, "'")}`;
process.on("uncaughtException", error => console.log("nobody catches", told(error)));
process.on("exit", code => console.log("the end", code));
console.log("the file runs");
exports.count = 6;
module.exports = { one: 1 };
