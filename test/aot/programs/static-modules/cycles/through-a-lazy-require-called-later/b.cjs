console.log("b runs");
const a = require("./a.cjs");
exports.saw = a.early + ":" + a.late;
