import { card } from "./card.mjs";
const state = "api";
export function api() {
  return state + " " + card();
}
