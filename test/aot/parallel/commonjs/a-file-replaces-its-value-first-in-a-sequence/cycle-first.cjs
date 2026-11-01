var second = require("./cycle-second.cjs");
module.exports = { name: "first", second: second }, module.exports.seenBySecond = second.seen;
