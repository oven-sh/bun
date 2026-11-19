const { width } = require("wick");
globalThis.bodiesOfLamp = (globalThis.bodiesOfLamp || 0) + 1;
exports.got = "got " + width;
exports.again = () => "again " + require("wick").width;
