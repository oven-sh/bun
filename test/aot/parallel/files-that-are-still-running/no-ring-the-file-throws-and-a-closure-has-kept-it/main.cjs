"use strict";
let later;
globalThis.look = function () {
  const ledger = require("./ledger.cjs");
  later = function () { return typeof ledger.total + ":" + (ledger.total + 1); };
  return "held";
};
let caught = "none";
try { require("./ledger.cjs"); } catch (error) { caught = error.message; }
console.log(caught, later());
