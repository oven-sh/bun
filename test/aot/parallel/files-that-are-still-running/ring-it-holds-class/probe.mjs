export function look() {
  const ledger = require("./ledger.cjs");
  try { return typeof ledger.total + ":" + new ledger.total().v; } catch (e) { return e.name; }
}
