exports.keysAtFirst = Object.keys(require("./requires-itself.cjs")).join();
exports.before = 1;
exports.self = require("./requires-itself.cjs");
exports.keysAtRequire = Object.keys(exports.self).join();
exports.same = exports.self === exports && exports.self === module.exports && exports.self === this;
exports.self.storedThroughItself = "stored";
exports.readBack = exports.storedThroughItself;
exports.after = 2;
