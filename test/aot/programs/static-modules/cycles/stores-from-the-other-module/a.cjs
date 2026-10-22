exports.count = 1;
exports.replaced = "by a";
const b = require("./b.cjs");
exports.count++;
exports.afterB = [exports.count, exports.replaced, exports.planted].join();
exports.planted = "by a";
