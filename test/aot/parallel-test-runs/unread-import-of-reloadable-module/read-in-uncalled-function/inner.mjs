import { base } from "./base.mjs";
import { mark } from "./leaf.mjs";
function unused() {
  return mark;
}
export const inner = "inner " + base;
