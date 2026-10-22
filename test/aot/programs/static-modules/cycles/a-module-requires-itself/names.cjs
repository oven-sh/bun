exports.before = 1;
const self = require("./names.cjs");
exports.sawBefore = self.before;
exports.sawAfter = self.after;
exports.after = 2;
exports.inFunction = () => require("./names.cjs").after;
self.storedThroughItself = 3;
exports.readBack = exports.storedThroughItself;
