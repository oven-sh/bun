console.log("second runs");
const first = require("./first.cjs");
console.log("second ends", new first.Counter().step());
