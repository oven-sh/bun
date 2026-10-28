// Fixed seeds of fuzz/literals-in-text-made-at-run-time-that-begin-like-what-the-program-hands-out.ts: text that is evaluated at run time writes object literals that begin with the members of
// literals the program hands out and go on with accessors, spreads, computed keys, indexes and prototypes; the text and the program change them in turns and the program reads them.
import { generate } from "./fuzz/literals-in-text-made-at-run-time-that-begin-like-what-the-program-hands-out";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "literals in text made at run time begin like what the program hands out",
  Array.from({ length: 60 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    make: () => ({ file: index & 1 ? "main.js" : "main.ts", text: generate(new Random(index + 1), !(index & 1)) }),
  })),
);
