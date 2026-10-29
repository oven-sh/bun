// Fixed seeds of fuzz/keys-of-built-in-objects-beside-what-a-compiler-writes-itself.ts: the own keys of a built-in object stand in the order they
// have in plain Bun, whether the program uses none, one or all of its members, and whatever the compiler writes for the rest of the program.
import {
  generate,
  holders,
  numberOfRounds,
  uses,
} from "./fuzz/keys-of-built-in-objects-beside-what-a-compiler-writes-itself";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

/** Built without --aot-validate today: a validating build reads at start each object that holds a member it names, here the classes of these two. */
const notValidatedToday = ["Intl", "WebAssembly"];

// Every run takes these, whatever else it takes.
const onceWrong = [16, 51, 100];

generated(
  "the keys of a built-in object stand in the order of plain Bun beside what a compiler writes itself",
  Array.from({ length: holders.length * uses.length * numberOfRounds }, (_, index) => {
    const holder = holders[Math.floor(index / (uses.length * numberOfRounds))];
    const use = uses[Math.floor(index / numberOfRounds) % uses.length];
    const round = index % numberOfRounds;
    return {
      name: `seed ${index + 1}: ${holder.path}, ${use} of its members, round ${round}.`,
      // Every run takes each object once; AOT_GENERATED=all takes all.
      isAlwaysRun:
        index % (uses.length * numberOfRounds) ===
        Math.floor(index / (uses.length * numberOfRounds)) % (uses.length * numberOfRounds),
      wasOnceWrong: onceWrong.includes(index + 1),
      isOnlyCompiled: true as const,
      flags: index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : [],
      ...(notValidatedToday.includes(holder.path) && { isNeverValidated: true as const }),
      make: () => ({ file: "main.mjs", text: generate(new Random(index + 1), holder, use, round) }),
    };
  }),
);
