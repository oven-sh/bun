require("./f2.mjs");
try { require("./f5.cjs"); } catch {}
var r8 = require("./f8.cjs");
console.log("f8 gives", r8.v8);
