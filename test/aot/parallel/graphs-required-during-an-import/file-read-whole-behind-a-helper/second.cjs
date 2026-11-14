const { shared } = require("./shared.mjs");
module.exports = { second: "second " + shared };
module.exports.more = require("./shared.mjs").shared;
