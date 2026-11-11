const Symbol = require("low/_Symbol");
exports.describe = value => typeof value + " " + typeof Symbol.iterator;
