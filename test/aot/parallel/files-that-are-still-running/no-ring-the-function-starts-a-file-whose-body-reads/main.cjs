"use strict";
globalThis.look = function () { return require("./probe.cjs").seen; };
const ledger = require("./ledger.cjs");
console.log(ledger.first, ledger.total);
