// fuzz/names-lengths-and-own-keys-of-functions-however-they-are-written.ts: functions and classes of every kind, written in every place that gives a name or gives none.
// They print `name` and `length` with their attributes, the own keys in their order, what `prototype` holds, and the prototype of the function.
import { generate } from "../names-lengths-and-own-keys-of-functions-however-they-are-written";
import { Random } from "../random";
import { endless } from "../family";

export default endless("names, lengths and own keys of functions however they are written", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
}));
