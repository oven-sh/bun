const ask = require("node:module").createRequire(__filename);
exports.later = () => ask("./part.cjs");
