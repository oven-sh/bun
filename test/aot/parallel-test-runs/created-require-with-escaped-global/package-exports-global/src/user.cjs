const Symbol = require("low/sign");
exports.describe = value => typeof value + " " + typeof Symbol.iterator;
