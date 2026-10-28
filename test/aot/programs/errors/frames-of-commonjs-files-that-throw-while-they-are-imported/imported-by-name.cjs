const { fail } = require("./fail.cjs");

exports.before = 1;
exports.value = fail("imported-by-name");
