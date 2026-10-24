console.log("root starts");
const a = require("./a.cjs");
const b = require("./b.cjs");
exports.report = () => b.saw + " " + b.now() + (a.late === 2 ? "" : "?");
