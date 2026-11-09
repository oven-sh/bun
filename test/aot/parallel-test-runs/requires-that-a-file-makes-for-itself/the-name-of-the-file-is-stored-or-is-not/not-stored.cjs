const { createRequire } = require("node:module");
require = createRequire(__filename);
module.exports = require("./which.cjs");
