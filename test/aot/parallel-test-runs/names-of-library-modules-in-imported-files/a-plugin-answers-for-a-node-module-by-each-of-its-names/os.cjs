const helper = require("./helper.cjs");
exports.platform = () => [typeof require("os").arch, helper.atTheTop, helper.later()].join("+");
