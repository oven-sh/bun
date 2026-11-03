exports.parent = module.parent;
exports.own = module;
exports.child = require(["./child", ".cjs"].join(""));
