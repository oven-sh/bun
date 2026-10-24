// A cycle of three bare requires: a requires b, b requires c, c requires a. Each body starts where the require stands, the last one finds the first half done, and each sees the one it required complete.
// STATISTIC: ModulesWithNames >= 3
// STATISTIC: ModulesWithoutState >= 4
const log = require("./log.cjs");
const a = require("./a.cjs"),
  b = require("./b.cjs"),
  c = require("./c.cjs");
log.push("main: " + [a.later(), b.later(), c.later()].join(" | "));
console.log(log.join("\n"));
