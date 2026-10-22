const { existsSync } = require("node:fs");
module.exports = { kind: typeof existsSync };
