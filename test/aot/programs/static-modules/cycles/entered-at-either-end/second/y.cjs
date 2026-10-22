const log = require("../log.cjs");
log.push("y starts");
const z = require("./z.cjs");
log.push("y sees z.late " + z.late);
exports.late = "y";
