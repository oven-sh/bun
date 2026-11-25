const r2 = require("./m2.mjs");
const r3 = require("./m3.mjs");
const b1 = require("node:os");
exports.t1 = "m1(" + [r2.t2, r3.t3, typeof b1].join() + ")";
