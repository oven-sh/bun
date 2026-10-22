const { format } = require("./index.cjs");
const index = require("./index.cjs");
exports.showByPattern = value => format(value);
exports.showByHolder = value => index.format(value);
