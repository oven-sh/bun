// fuzz/what-a-literal-makes-is-new-each-time.ts: lists, objects, regular expressions, functions and classes written as literals, in functions that are called again and again.
// What one call's object is changed into does not show in the next call's. They print each object before and behind the changes, and the next one.
import { Random } from "../random";
import { generate } from "../what-a-literal-makes-is-new-each-time";
import { endless } from "../family";

export default endless("what a literal makes is new each time", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
}));
