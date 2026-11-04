"use strict";
exports.look = function () {
  try {
    const ledger = require("./ledger.mjs");
    return typeof ledger.total + ":" + (ledger.total + 1);
  } catch (error) { return error.name; }
};
