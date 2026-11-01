// RUN: lower
// CHECK: Add

var let = 1,
  public = 2,
  yield = 4;
module.exports = let + public + yield;
console.log(module.exports);
