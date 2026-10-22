const first = require("./x.cjs");
require = () => ({ n: "replaced" });
const second = require("./x.cjs");
exports.result = first.n + " " + second.n;
