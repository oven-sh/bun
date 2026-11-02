// Strict Bun.deepEquals() compares the `constructor` of two objects, which a typed object may own as a field or outside its cell.
import { cases } from "./cases";
const say = (b: boolean) => (b ? "T" : "f");
for (const [name, left, right] of cases) {
  const l = left(), r = right();
  // The strict comparison comes first: nothing else has read the prototype of a class by then.
  const strict = say(Bun.deepEquals(l, r, true)) + say(Bun.deepEquals(r, l, true));
  console.log("ROW", name + ":", say(Bun.deepEquals(l, r)) + say(Bun.deepEquals(r, l)), strict);
}
