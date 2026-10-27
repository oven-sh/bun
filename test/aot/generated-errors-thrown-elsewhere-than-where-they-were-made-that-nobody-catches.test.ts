// Fixed seeds of fuzz/errors-thrown-elsewhere-than-where-they-were-made-that-nobody-catches.ts: an error is made in one function and thrown in another, and leaves a timer, a tick, a microtask,
// a listener, a promise or the module itself with nobody to catch it. The program starts itself for each case and prints what that process wrote about the error.
import { generate } from "./fuzz/errors-thrown-elsewhere-than-where-they-were-made-that-nobody-catches";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "errors thrown elsewhere than where they were made that nobody catches",
  Array.from({ length: 60 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    startsItself: true as const,
    // Plain Bun lists the frame of a module for an error that was made under it only until a collection has run behind the end of that frame.
    hangsOnCollections: true as const,
    make: () => ({ file: "main.mjs", text: generate(new Random(index + 1)) }),
  })),
);
