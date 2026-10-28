// Fixed seeds of fuzz/modules-asked-for-again-after-they-have-run.ts: small programs of four or five files in which the first file loads the others with `import()`, a few steps in a row, with pauses in
// between. A module runs once; whoever asks for it again gets the same namespace object with the values of that moment; a module that threw rejects every later `import()` with the same error.
import { generate } from "./fuzz/modules-asked-for-again-after-they-have-run";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "modules asked for again after they have run",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more road to a file would change the order in which the files run.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
