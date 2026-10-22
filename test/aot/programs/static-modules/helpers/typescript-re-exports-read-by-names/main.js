// The same form with two names cleared in one statement, read by names alone: each read through the barrel is a read of the other module's export at that moment.
// STATISTIC: ModulesWithNames >= 2
const index = require("./index"),
  lib = require("./lib");
console.log(index.a, typeof index.B);
lib.setA(2);
console.log(index.a, lib.a);
