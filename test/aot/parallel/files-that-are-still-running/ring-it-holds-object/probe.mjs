export function look() {
  const ledger = require("./ledger.cjs");
  try { return typeof ledger.total + ":" + ledger.total.a + ":" + ledger.total.b; } catch (e) { return e.name; }
}
