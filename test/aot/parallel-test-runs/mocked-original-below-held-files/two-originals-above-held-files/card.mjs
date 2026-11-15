import { above } from "./above.mjs";
const state = "card";
export function card() {
  return state + " " + above();
}
