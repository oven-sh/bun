console.log("second runs");
const shared = require("./shared.cjs");
console.log("second ends", new shared.Counter().step());
