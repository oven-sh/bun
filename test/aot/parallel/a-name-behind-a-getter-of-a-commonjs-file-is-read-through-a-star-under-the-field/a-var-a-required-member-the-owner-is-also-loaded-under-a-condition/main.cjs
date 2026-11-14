const make = require("./outer/index.mjs").make;
console.log("SAID", typeof make);
if (process.env.NOPE_NOT_SET) require("./dep/owner.cjs");
