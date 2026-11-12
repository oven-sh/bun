const tax = require("./tax.cjs");
exports.seen = typeof tax.rate;
exports.now = () => typeof require("./tax.cjs").fee;
