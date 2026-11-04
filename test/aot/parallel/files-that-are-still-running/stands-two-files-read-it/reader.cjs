"use strict";
const ledger = require("./ledger.cjs");
exports.show = function () { return typeof ledger.total + ":" + (ledger.total + 1); };
