exports.early = "set before the file ends";
const again = require("./cycle.cjs");
exports.early = again.early + "!";
