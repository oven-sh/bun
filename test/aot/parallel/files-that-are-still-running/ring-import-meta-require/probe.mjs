export function look() {
  const ledger = import.meta.require("./ledger.cjs");
  return typeof ledger.total + ":" + (ledger.total + 1);
}
