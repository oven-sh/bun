"use strict";
globalThis.look = function () {
  const ledger = require("./ledger.cjs");
  return typeof ledger.total + ":" + (ledger.total + 1);
};
const ledger = require("./ledger.cjs");
console.log(ledger.first, ledger.second);
