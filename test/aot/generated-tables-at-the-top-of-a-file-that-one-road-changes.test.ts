// Fixed seeds of fuzz/tables-at-the-top-of-a-file-that-one-road-changes.ts: small programs about one `const` at the top of a file that holds a table (an object, a list, a table in a table, a `Map`), one
// function that reads it, and one change to the table, made by one road. The function is called ahead of the change and behind it, and the second call sees it.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/tables-at-the-top-of-a-file-that-one-road-changes";
import { generated } from "./generated/run-generated";

generated(
  "tables at the top of a file that one road changes",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more use of the table would be one more thing known about it.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
