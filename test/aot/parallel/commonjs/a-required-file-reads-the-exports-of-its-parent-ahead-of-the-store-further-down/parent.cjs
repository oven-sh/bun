var seen = require("./child.cjs");
function parent() {}
module.exports = parent, module.exports.marker = true;
module.exports.seen = seen;
