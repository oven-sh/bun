exports.early = "early1"
const other = require("./cycle2.js")
exports.seen = other.seen
exports.late = "late1"
