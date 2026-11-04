export function look() {
  const ledger = require("./ledger.cjs");
  try { return "got " + ledger.get().a; } catch (error) { return error.name; }
}
