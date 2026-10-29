require("./log.js").log.push("two runs");
exports.value = require("./one.js").value + 1;
