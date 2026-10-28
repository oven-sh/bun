// Fixed seeds of fuzz/loops-over-variables-of-enclosing-code.ts: a loop reads and stores variables of its module, of the functions around it and of the turns of a loop around it, while a callee,
// a closure made in the loop, an accessor, a callback of a built-in, a step of a generator or what runs at an await reads and stores them too. What every turn saw and what the variables hold
// behind each loop is what plain Bun prints.
import { generate } from "./fuzz/loops-over-variables-of-enclosing-code";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "loops see the variables of enclosing code as in plain Bun",
  Array.from({ length: 400 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first 100 seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 100,
    isOnlyCompiled: true as const,
    flags: [
      ...(index % 4 >= 2 ? ["--aot-erase-types"] : []),
      ...(index % 2 === 1 ? ["--aot-heat=everything-is-hot"] : []),
    ],
    make: () => ({ file: "main.ts", text: generate(new Random(index + 1)), files: {} }),
  })),
);
