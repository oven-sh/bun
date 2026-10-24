const a = require("./a.cjs");
exports.saw = a.early + ":" + a.late;
exports.now = () => a.late;
