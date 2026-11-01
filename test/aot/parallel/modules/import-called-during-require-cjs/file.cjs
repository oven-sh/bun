console.log("file begins");
let reads = 0;
exports.first = 1;
Object.defineProperty(exports, "read", { enumerable: true, get: () => ++reads });
require("./imports-back.mjs");
exports.first = 2;
exports.count = 7;
console.log("file ends");
