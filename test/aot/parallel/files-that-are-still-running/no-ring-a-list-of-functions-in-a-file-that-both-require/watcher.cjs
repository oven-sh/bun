"use strict";
const registry = require("./registry.cjs");
registry.add(function () {
  const ledger = require("./ledger.cjs");
  return typeof ledger.total + ":" + (ledger.total + 1);
});
