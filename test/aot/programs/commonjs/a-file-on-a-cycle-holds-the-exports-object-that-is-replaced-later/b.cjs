const a = require("./a.cjs");
exports.held = a;
exports.heldName = () => a.name;
exports.again = () => require("./a.cjs");
