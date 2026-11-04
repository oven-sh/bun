var first = require("./cycle-first.cjs");
module.exports = { name: "second" }, module.exports.seen = typeof first + ":" + Object.keys(first).length;
