import { sum } from "./lib.mjs";
import "./start.cjs";
const table = { used() { return 1; }, never() { return import("./lib.mjs"); } };
function warm() {
  let total = 0;
  for (let i = 0; i < 300; i++) total = (sum(total, i) + table.used()) | 0;
  return total;
}
console.log(String(warm()));
