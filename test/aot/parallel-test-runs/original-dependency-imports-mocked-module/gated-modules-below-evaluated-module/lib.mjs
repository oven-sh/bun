import { one } from "./one.mjs";
import { two } from "./two.mjs";
export { one, two };
export function read() {
  return one + " " + two;
}
