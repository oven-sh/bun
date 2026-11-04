"use strict";
function show() {
  const ledger = require("./ledger.cjs");
  return typeof ledger.total + ":" + (ledger.total + 1);
}
console.log(show(), show());
