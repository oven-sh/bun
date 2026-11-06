const told = error => `${error?.name}: ${error?.message.replace(/'[^']*[\\/]/, "'")}`;
process.on("uncaughtException", error => console.log("nobody catches", told(error)));
process.on("exit", code => console.log("the end", code));

console.log("the file begins");
exports.first = 1;
for (const turn of [1, 2]) {
  try {
    console.log("required", turn, Object.keys(require("./main.mjs")).join());
  } catch (error) {
    console.log("require throws", turn, told(error));
  }
}
exports.second = 2;
console.log("the file ends");
