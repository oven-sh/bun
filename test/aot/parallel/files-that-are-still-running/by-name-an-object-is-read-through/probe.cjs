"use strict";
exports.look = function () {
  const ledger = require("./ledger.cjs");
  try { return typeof ledger.total + ":" + ledger.total.a + ":" + ledger.total.b; } catch (error) { return error.name; }
};
