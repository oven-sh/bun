import { other } from "./second.mjs";
import { add } from "./third.mjs";
export function viaThird(n) {
  return add(n) + other();
}
