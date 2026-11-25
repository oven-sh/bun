const first = require("./first.cjs");
exports.sawOfFirst = Object.keys(first).join();
exports.look = () => Object.keys(require("./first.cjs")).join();
