const a = require("./cycle-a.cjs");
exports.saw = a.early + ":" + a.late;
