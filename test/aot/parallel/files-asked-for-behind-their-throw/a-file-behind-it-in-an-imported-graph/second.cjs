const first = require("./first.cjs");
exports.count = new first.Counter().step();
console.log("second ends", exports.count);
