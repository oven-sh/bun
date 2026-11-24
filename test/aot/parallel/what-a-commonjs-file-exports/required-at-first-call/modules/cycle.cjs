module.exports = function run(n) { return n + back.value; };
const back = require("./cycle-back.cjs");
module.exports.seen = back.kind;
