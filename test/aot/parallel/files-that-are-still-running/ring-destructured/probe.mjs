export function look() {
  const { total } = require("./ledger.cjs");
  return typeof total + ":" + (total + 1);
}
