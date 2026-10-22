const e = require("./e.mjs");
exports.seen = Object.keys(e).length + ":" + e.value;
exports.later = () => Object.keys(e).length + ":" + e.value;
