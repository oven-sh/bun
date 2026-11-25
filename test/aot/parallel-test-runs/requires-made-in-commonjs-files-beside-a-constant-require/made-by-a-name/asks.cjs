const { createRequire } = require("node:module");
const ask = createRequire(__filename);
exports.later = () => ask("./part.cjs");
