const { createRequire } = require("node:module");
require = createRequire(__filename);
exports.loaded = require("./other.cjs").other + ", " + require("dep").dep;
