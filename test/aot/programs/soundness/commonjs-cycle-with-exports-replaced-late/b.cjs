const a = require("./a.cjs");
exports.held = a;
exports.sawType = typeof a;
exports.sawKeys = Object.keys(a).join();
exports.readLater = () => typeof require("./a.cjs") + ":" + a.name + ":" + a.late;
