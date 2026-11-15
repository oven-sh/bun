export function look() {
  const ledger = require("./ledger.cjs");
  try { return typeof ledger.total + ":" + (ledger.total ? "yes" : "no") + ":" + (ledger.total === undefined); } catch (e) { return e.name; }
}
