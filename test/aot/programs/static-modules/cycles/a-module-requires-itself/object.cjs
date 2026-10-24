exports.before = 1;
const self = require("./object.cjs");
exports.same = self === exports && self === module.exports;
exports.keys = Object.keys(self).join();
exports.after = 2;
