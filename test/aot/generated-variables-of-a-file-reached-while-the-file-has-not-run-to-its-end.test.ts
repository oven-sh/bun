// Fixed seeds of fuzz/variables-of-a-file-reached-while-the-file-has-not-run-to-its-end.ts: small programs of two or three files about one variable at the top of a file and another file that reaches it
// while the first has not run to its end: the two need each other, or the first loads, calls or waits for the second in the middle of its body. A store made on the way is there when the file goes on.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/variables-of-a-file-reached-while-the-file-has-not-run-to-its-end";
import { generated } from "./generated/run-generated";

generated(
  "variables of a file reached while the file has not run to its end",
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
