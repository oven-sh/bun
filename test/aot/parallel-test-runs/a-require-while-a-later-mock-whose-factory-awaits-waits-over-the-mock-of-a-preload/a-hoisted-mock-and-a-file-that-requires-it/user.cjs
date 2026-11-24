const part = require("./part.cjs");
exports.a = part.a;
exports.later = () => require("./part.cjs").a;
