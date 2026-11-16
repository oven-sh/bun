const r3 = require("./m3.mjs");
(globalThis.waits ??= []).push(import("./m3.mjs").then(names => "m2>" + Object.keys(names).sort().slice(0, 3).join("+")));
module.exports = { t2: "m2(" + [r3.t3].join() + ")" };
