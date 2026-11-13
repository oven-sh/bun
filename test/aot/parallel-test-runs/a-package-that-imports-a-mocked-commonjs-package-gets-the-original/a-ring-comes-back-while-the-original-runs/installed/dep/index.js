exports.early = "real-early";
const other = require("./other.js");
exports.value = () => "real";
exports.atLoad = other.atLoad;
