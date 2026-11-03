console.log("file begins");
module.exports = function f() {};
module.exports.first = 1;
globalThis.readOwn = () => typeof module.exports;
require("./main.mjs");
console.log("file ends");
