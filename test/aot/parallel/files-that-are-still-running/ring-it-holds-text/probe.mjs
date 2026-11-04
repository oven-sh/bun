export function look() {
  const ledger = require("./ledger.cjs");
  try { return typeof ledger.total + ":" + ledger.total.length + ":" + ledger.total.toUpperCase(); } catch (e) { return e.name; }
}
