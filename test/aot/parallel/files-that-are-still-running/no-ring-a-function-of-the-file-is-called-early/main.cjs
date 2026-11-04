"use strict";
globalThis.look = function () {
  const ledger = require("./ledger.cjs");
  try { return ledger.describe(); } catch (error) { return error.name; }
};
const ledger = require("./ledger.cjs");
console.log(ledger.first, ledger.second);
