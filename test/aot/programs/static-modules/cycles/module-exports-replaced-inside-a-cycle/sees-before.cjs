const held = require("./before.cjs");
exports.keysThen = Object.keys(held).join();
exports.keysLater = () => Object.keys(held).join();
exports.early = held.early;
exports.late = () => held.late;
