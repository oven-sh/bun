const b = require("./b.cjs");
exports.before = String(b.read());
exports.late = "late";
exports.after = b.read();
