exports.n = 0;
const b = require("./b.cjs");
exports.bump = () => ++exports.n;
exports.viaB = b.read;
