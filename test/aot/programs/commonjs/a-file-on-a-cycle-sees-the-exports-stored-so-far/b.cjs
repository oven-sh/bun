const a = require("./a.cjs");
exports.seen = [a.early, a.late, typeof a.f, Object.keys(a).join()].join("|");
