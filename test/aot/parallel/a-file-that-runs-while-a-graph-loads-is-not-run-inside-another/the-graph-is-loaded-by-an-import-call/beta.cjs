const { existsSync } = require("fs");
exports.kind = typeof existsSync;
