import { card } from "./card.mjs";
const state = "click";
export function click() {
  return state + " " + card();
}
