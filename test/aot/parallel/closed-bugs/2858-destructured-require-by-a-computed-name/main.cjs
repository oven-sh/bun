const { used } = require("./lib/c.cjs");
const spec = process.argv[2] ?? "./lib/c.cjs";
const { unused } = require(spec);
console.log(used(2), unused(2));
