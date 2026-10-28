import { results } from "./results.js";
import { second, readFirst } from "./second.js";
export const first = false;
export function readLate() {
  return [second, readFirst(), first ? "first is set" : "first is not set"];
}
results.push(["first has run", second]);
