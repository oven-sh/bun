const a = require("./a.cjs");
exports.seen = a.early({ undefined: "b finds it under undefined" });
