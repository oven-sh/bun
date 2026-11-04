"use strict";
const reader = require("./reader.cjs");
const ledger = require("./ledger.cjs");
console.log(reader.show(), typeof ledger.total + ":" + (ledger.total + 1));
