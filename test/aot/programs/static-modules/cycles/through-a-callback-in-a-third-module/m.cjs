exports.early = 1;
exports.seenByNames = require("./registry.cjs").run("names");
exports.seenAsAnObject = require("./registry.cjs").run("object");
exports.late = 2;
