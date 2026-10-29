// Fixed seeds of fuzz/built-ins-that-change-what-they-are-handed-read-beside-the-call.ts: small programs in which a built-in changes what it is called on or handed (a regular expression's `lastIndex`,
// a list's length, a map's size, the bytes of a buffer that two views share, a date, an iterator, an object, `process.env`), and the program reads that beside the call. Every line is printed at once.
import { generate } from "./fuzz/built-ins-that-change-what-they-are-handed-read-beside-the-call";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "built-ins that change what they are handed, read beside the call",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: whatever a run adds would stand between a call and a read.
    keepsItsText: true as const,
    make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
  })),
);
