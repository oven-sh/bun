exports.v = 7;
exports.who = () => require("node:path").basename(module.parent.id) + module.children.length;
