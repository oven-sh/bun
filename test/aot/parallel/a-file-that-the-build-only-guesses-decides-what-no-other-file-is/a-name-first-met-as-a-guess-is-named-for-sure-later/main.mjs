import "./kind.cjs";
import "./first.cjs";
const table = { wanted: "./wanted.cjs" };
export const seen = JSON.stringify(table);
function load(go, key) {
  if (!go) return;
  return import.meta.require(table[key]);
}
load(false, "wanted");
console.log("SAID end");
