// fuzz/object-literals-with-members-of-every-kind.ts: literals with values, methods, getters, setters and spreads under keys of every kind, `__proto__` in every spelling and `super`
// in their methods, made several times with other keys and values. They print the order of everything, the keys with their attributes, the names of all functions and what the members answer.
import { generate, written } from "../object-literals-with-members-of-every-kind";
import { Random } from "../random";
import { endless } from "../family";

export default endless("object literals with members of every kind", index => {
  // Every tenth program ends with what plain Bun answers otherwise than the language says: there the answer of Node.js is written down.
  const hasWhatIsWritten = index % 10 === 9;
  return {
    name: `seed ${index + 1}.`,
    written: hasWhatIsWritten ? written : undefined,
    make: () => ({ file: "main.js", text: generate(new Random(index + 1), hasWhatIsWritten) }),
  };
});
