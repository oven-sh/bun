const a = require("./litcycle_a");
exports.sawName = String(a.name);
exports.late = function () { return String(a.name); };
