const r4 = require("./m4.cjs");
const r7 = require("./m7.cjs");
module.exports = { t2: "m2(" + [r4.t4, r7.t7].join() + ")" };
module.exports.late2 = function () {
};
