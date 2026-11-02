Object.defineProperty(exports, "first", { enumerable: true, get: () => (console.log("getter runs"), 1) });
require("./imports-back.mjs");
exports.second = 2;
console.log("file ends");
