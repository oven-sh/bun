import { leaf } from "./leaf.mjs";
import { above } from "./above.mjs";
const state = "card";
export function card() {
  return state + " " + leaf() + " " + above();
}
