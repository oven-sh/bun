console.log("SAID f0 begins");
require("./f2.mjs");
var r8; try { r8 = require("./f8.cjs"); } catch (e) { r8 = "fallback " + e.name; }
console.log("SAID f0 ends", typeof r8 === "string" ? r8 : Object.keys(r8).join());
