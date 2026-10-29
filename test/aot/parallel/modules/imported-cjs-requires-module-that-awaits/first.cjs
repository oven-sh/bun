console.log("first begins");
exports.early = 1;
require("./waits.mjs");
exports.late = 2;
console.log("first ends");
