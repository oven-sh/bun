"use strict";
const bus = require("./bus.cjs");
bus.on("look", function (answers) {
  const ledger = require("./ledger.cjs");
  answers.push(typeof ledger.total + ":" + (ledger.total + 1));
});
const ledger = require("./ledger.cjs");
console.log(ledger.first, ledger.second);
