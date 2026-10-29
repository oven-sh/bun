// A later require of a commonjs entry point that threw behind a graph that imports it.
console.log("main begins");
exports.early = 1;
require("./late.cjs");
require("./a.mjs");
exports.late = 2;
throw new RangeError("thrown by main");
