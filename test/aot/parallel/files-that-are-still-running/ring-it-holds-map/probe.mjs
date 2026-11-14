export function look() {
  const ledger = require("./ledger.cjs");
  try { return typeof ledger.total + ":" + ledger.total.size + ":" + ledger.total.get("k"); } catch (e) { return e.name; }
}
