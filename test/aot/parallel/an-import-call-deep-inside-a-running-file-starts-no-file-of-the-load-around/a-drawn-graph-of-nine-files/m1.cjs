const { t2 } = require("./m2.mjs");
const { t4 } = require("./m4.cjs");
(globalThis.waits ??= []).push(import("./m3.mjs").then(names => "m1>" + Object.keys(names).sort().slice(0, 3).join("+")));
exports.t1 = "m1(" + [t2, t4].join() + ")";
