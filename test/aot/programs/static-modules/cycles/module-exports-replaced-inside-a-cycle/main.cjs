// `module.exports = { .. }` in a module on a cycle. Stored behind the require that closes the cycle, it leaves the other module with the first object for ever, and a later require answers the new one. Stored ahead of that require, it is the object that the other module holds and that later stores fill.
const after = require("./after.cjs"),
  seesAfter = require("./sees-after.cjs");
console.log(Object.keys(after).join(), seesAfter.keysThen, seesAfter.keysLater(), seesAfter.again());
const before = require("./before.cjs"),
  seesBefore = require("./sees-before.cjs");
console.log(Object.keys(before).join(), seesBefore.keysThen, seesBefore.keysLater(), seesBefore.early, seesBefore.late());
