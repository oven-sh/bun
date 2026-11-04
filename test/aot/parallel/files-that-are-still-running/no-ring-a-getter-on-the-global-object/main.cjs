"use strict";
Object.defineProperty(globalThis, "glance", { get() {
  const ledger = require("./ledger.cjs");
  return typeof ledger.total + ":" + (ledger.total + 1);
} });
const ledger = require("./ledger.cjs");
console.log(ledger.first, ledger.second);
