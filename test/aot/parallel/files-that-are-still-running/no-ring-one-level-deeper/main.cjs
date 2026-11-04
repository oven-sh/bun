"use strict";
const deeper = require("./deeper.cjs");
globalThis.look = function () { return deeper.look(); };
const ledger = require("./ledger.cjs");
console.log(ledger.first, ledger.second);
