export function look() {
  const ledger = require("./ledger.cjs");
  try { return typeof ledger.total + ":" + ledger.total(); } catch (e) { return e.name; }
}
