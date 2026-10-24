module.parent = module;
module.children = [];
exports.answer = "inner " + require("./other.cjs").answer;
