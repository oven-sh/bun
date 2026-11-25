const { test } = require("bun:test");
const { writeFileSync } = require("fs");
writeFileSync(
  __dirname + "/later.cjs",
  "try { require('./shaky.cjs'); exports.said = 'loaded'; } catch (error) { exports.said = error.message; }",
);
const said = require("./later.cjs").said;
console.log("the first load said", said, "after", process.env.RUNS_OF_SHAKY);
const shaky = require("./shaky.cjs");
console.log("the second load holds", shaky.early, shaky.late, "after", process.env.RUNS_OF_SHAKY);
test("a", () => {});
