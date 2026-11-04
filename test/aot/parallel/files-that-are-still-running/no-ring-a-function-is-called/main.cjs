"use strict";
globalThis.look = function () {
  const ledger = require("./ledger.cjs");
  try { return typeof ledger.total + ":" + ledger.total(); } catch (error) { return error.name; }
};
const ledger = require("./ledger.cjs");
console.log(ledger.first, ledger.second);
