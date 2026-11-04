import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export function look() {
  const ledger = require("./ledger.cjs");
  return typeof ledger.total + ":" + (ledger.total + 1);
}
