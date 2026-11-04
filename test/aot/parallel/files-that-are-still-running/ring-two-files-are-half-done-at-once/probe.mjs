export function look() {
  const ledger = require("./ledger.cjs");
  const annex = require("./annex.cjs");
  return typeof ledger.total + ":" + (ledger.total + 1) + ":" + typeof annex.count + ":" + (annex.count + 1);
}
