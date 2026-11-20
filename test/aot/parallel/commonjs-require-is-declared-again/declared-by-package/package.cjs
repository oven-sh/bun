var require = require || null;
var dep = require("./dep.cjs");
exports.answer = () => "package: " + dep.name + ", " + require("./later.cjs");
