const { fail } = require("./fail.cjs");
exports = module.exports = function () {};
exports.value = fail("assigns to exports");
