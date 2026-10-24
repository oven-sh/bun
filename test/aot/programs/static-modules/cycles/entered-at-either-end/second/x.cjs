const log = require("../log.cjs");
log.push("x starts");
const y = require("./y.cjs");
log.push("x sees y.late " + y.late);
exports.late = "x";
