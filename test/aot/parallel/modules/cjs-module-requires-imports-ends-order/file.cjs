console.log("file begins");
exports.first = 1;
exports.add = (a, b) => a + b;
console.log("file got", Object.keys(require("./main.mjs")).join());
exports.second = 2;
console.log("file ends");
