exports.early = 1;
const r = require("./r.cjs");
exports.sawKeysOfR = Object.keys(r).join() + "|" + (r === exports);
exports.late = 2;
exports.rLater = () => require("./r.cjs") === exports;
