console.log("file begins");
exports.first = 1;
globalThis.readOwn = () => [Object.keys(exports).join(), Object.keys(module.exports).join(), module.exports === exports].join(" ");
require("./main.mjs");
exports.second = 2;
console.log("file ends");
