// Fixed seeds of fuzz/own-properties-copied-by-descriptor-and-changed-afterwards.ts: a loop copies the own properties of a source to a target by
// descriptor; the descriptor may be changed, kept, renamed or used twice on the way. Afterwards members of the source are replaced, and what
// was copied is read, called and listed. One seed in four is a CommonJS file that is not strict.
import { generate } from "./fuzz/own-properties-copied-by-descriptor-and-changed-afterwards";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "properties copied by descriptor are what they are in plain Bun",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    make: () => ({ file: index % 4 === 3 ? "main.cjs" : "main.mjs", text: generate(new Random(index + 1)) }),
  })),
);
