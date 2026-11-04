exports.early = () => late;
exports.viaFunction = () => helper();
const other = require("./lib-cycle-b.cjs");
const late = "late of a";
function helper() { return late + "!"; }
exports.other = other;
