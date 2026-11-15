const got = require("./a.cjs");
exports.seen = () => Object.keys(got).join() + " " + String(got.c(1)) + " " + Object.prototype.toString.call(got);
