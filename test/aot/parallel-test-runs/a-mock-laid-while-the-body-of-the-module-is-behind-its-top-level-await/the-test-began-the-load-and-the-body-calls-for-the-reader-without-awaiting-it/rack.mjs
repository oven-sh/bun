import { look } from "./kiln.mjs";
export function fetchIt() {
  globalThis.shelf = import("./shelf.mjs").then(it => it.read());
  return globalThis.shelf;
}
export const seen = () => look();
globalThis.log.push("rack runs");
