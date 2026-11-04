let held;
export function look() {
  const { total } = require("./ledger.cjs");
  held = total;
  return typeof held;
}
export function kept() { return typeof held + ":" + (held + 1); }
