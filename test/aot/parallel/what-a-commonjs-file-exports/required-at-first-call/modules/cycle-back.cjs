const run = require("./cycle.cjs");
exports.kind = typeof run;
exports.value = 40;
exports.again = () => require("./cycle.cjs")(1);
