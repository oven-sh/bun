"use strict";
const ledger = require("./ledger.cjs");
function show() { return typeof ledger.total + ":" + (ledger.total + 1); }
console.log(show(), show(), ledger.label);
