const first = require("./after.cjs");
exports.keysThen = Object.keys(first).join();
exports.keysLater = () => Object.keys(first).join();
exports.again = () => Object.keys(require("./after.cjs")).join();
