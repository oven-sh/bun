export function look() {
  const ledger = require("./led" + "ger.cjs");
  return typeof ledger.total + ":" + (ledger.total + 1);
}
