const { createRequire } = require("node:module");
__dirname = __dirname + "/inner";
require = createRequire(__filename);
module.exports = require("./which.cjs");
