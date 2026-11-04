export function look() {
  const ledger = require("./ledger.cjs");
  try { return (ledger.total.n = 5, "stored " + ledger.total.n); } catch (e) { return e.name; }
}
