// other.mjs runs first and calls `read`, a declared function of this file, which has not begun: its bindings are empty.
import { said } from "./other.mjs";
const limit = { n: 5 };
const keep = () => limit.n;
export function read() {
  return keep() + limit.n;
}
console.log(said, read());
