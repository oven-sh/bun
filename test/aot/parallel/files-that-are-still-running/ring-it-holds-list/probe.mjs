export function look() {
  const ledger = require("./ledger.cjs");
  try { return typeof ledger.total + ":" + ledger.total.length + ":" + ledger.total[1]; } catch (e) { return e.name; }
}
