exports.early = () => "early";
const other = require("./lib-cycle-two.cjs");
exports.late = () => "late " + other.seen;
