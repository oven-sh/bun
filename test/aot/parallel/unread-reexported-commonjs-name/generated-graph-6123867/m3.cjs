const r4 = require("./m4.cjs");
const r7 = require("./m7.mjs");
module.exports = { t3: "m3(" + [r4.t4, r7.t7, r7.t9].join() + ")" };
module.exports.t4 = require("./m4.cjs").t4;
module.exports.t7 = require("./m7.mjs").t7;
