"use strict";
const ledger = require("./ledger.cjs");
exports.seen = typeof ledger.total + ":" + (ledger.total + 1);
