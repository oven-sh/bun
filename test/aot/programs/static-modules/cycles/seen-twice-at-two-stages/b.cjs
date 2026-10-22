const a = require("./a.cjs");
exports.saw = [a.one, a.two, a.three].join("-");
exports.now = () => [a.one, a.two, a.three].join("-");
