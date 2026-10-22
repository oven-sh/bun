const log = require("../log.cjs");
log.push("z starts");
const x = require("./x.cjs");
log.push("z sees x.late " + x.late);
exports.late = "z";
