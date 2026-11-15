const { createRequire } = require("node:module");
__filename = __filename.replace("added-to.cjs", "");
__filename += "inner/anchor.cjs";
require = createRequire(__filename);
module.exports = require("./which.cjs");
