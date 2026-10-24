const a = require("./a.cjs");
exports.keysOfA = Object.keys(a).join();
exports.copyOfA = { ...a };
exports.hasLast = "last" in a;
exports.json = JSON.stringify(a);
exports.held = a;
exports.later = () => [Object.keys(a).join(), "last" in a, JSON.stringify(exports.copyOfA)].join(" ");
