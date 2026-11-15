console.log("first runs");
const shared = require("./shared.cjs");
console.log("first ends", new shared.Counter().step());
