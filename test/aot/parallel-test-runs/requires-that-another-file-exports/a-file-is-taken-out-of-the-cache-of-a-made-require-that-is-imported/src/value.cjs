const counter = require("./counter.cjs");
counter.runs += 1;
exports.run = counter.runs;
