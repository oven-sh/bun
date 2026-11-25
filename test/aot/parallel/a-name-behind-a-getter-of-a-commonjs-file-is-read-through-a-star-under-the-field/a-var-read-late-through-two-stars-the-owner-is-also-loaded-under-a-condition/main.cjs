const outer = require("./outer/index.mjs");
console.log("SAID", typeof outer.make);
if (process.env.NOPE_NOT_SET) require("./dep/owner.cjs");
