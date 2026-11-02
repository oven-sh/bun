Object.defineProperty(exports, "first", { enumerable: true, get: () => (console.log("getter runs"), 1) });
exports.second = 2;
require("./main.mjs");
exports.third = 3;
console.log("file ends");
