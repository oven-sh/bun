export function look() {
  const ledger = require("./ledger.cjs");
  try { return typeof ledger.total + ":" + String(ledger.total) + ":" + String({ x: 1 }[ledger.total]); } catch (e) { return e.name; }
}
