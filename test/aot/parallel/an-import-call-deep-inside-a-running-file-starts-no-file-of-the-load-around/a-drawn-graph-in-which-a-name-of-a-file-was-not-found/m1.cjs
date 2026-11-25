const r2 = require("./m2.mjs");
const { t6 } = require("./m6.cjs");
const r4 = require("./m4.mjs");
const r5 = require("./m5.cjs");
const b1 = require("node:os");
const later1 = () => import("./m2.mjs");
exports.t1 = "m1(" + [r2.t2, t6, r4.t4, r5.t5, typeof b1, typeof later1].join() + ")";
