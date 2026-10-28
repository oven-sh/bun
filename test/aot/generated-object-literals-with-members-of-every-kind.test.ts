// Fixed seeds of fuzz/object-literals-with-members-of-every-kind.ts: literals with values, methods, getters, setters and spreads under keys of every kind, `__proto__` in every spelling and `super`
// in their methods, made several times with other keys and values. They print the order of everything, the keys with their attributes, the names of all functions and what the members answer.
import { generate, written } from "./fuzz/object-literals-with-members-of-every-kind";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "object literals with members of every kind",
  Array.from({ length: 120 }, (_, index) => {
    // Every tenth program ends with what plain Bun answers otherwise than the language says: there the answer of Node.js is written down.
    const hasWhatIsWritten = index % 10 === 9;
    return {
      name: `seed ${index + 1}.`,
      // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
      isAlwaysRun: index < 12,
      isOnlyCompiled: true as const,
      written: hasWhatIsWritten ? written : undefined,
      make: () => ({ file: "main.js", text: generate(new Random(index + 1), hasWhatIsWritten) }),
    };
  }),
);
