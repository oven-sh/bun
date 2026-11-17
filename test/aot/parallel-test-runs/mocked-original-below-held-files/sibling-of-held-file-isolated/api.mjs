import { leaf } from "./leaf.mjs";
import { card } from "./card.mjs";
const state = "api";
export function api() {
  return state + " " + leaf() + " " + card();
}
