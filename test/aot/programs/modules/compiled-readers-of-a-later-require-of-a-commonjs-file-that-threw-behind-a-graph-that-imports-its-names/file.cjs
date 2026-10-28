console.log("file begins");
let calls = 0;
exports.first = 1;
exports.count = () => ++calls;
exports.box = { value: 10 };
globalThis.whileFileRuns?.();
require("./main.mjs");
exports.second = 2;
console.log("file ends");
