const r2 = require("./m2.mjs");
const r4 = require("./m4.mjs");
const { t6 } = require("./m6.cjs");
const b1 = require("node:crypto");
const later1 = () => import("./m2.mjs");
exports.t1 = "m1(" + [r2.t2, r4.t4, t6, typeof b1, typeof later1].join() + ")";
