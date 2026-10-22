const a = require("./a.cjs");
exports.saw = a.early + ":" + a.late;
exports.later = () => a.early + ":" + a.late;
