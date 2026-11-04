"use strict";
globalThis.look = function () {
  const { total } = require("./ledger.cjs");
  return typeof total + ":" + (total + 1);
};
const ledger = require("./ledger.cjs");
console.log(ledger.first, ledger.second);
