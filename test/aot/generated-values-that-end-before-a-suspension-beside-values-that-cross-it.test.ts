// Fixed seeds of fuzz/values-that-end-before-a-suspension-beside-values-that-cross-it.ts: async functions, generators and async generators hold
// many values at once, of which some are last read before a suspension and others behind it: straight on, in a later turn of a loop, in a catch,
// in a finally, or when the caller throws into the coroutine or returns from it. Every read prints what it prints in plain Bun.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/values-that-end-before-a-suspension-beside-values-that-cross-it";
import { generated } from "./generated/run-generated";

// Every run takes these, whatever else it takes. They also report that an object last read before a loop of collections and waits was collected.
const onceWrong = [9, 11, 75, 80, 104, 106, 140, 183, 208, 224];

generated(
  "values that end before a suspension and values that cross it read as in plain Bun",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    flags: onceWrong.includes(index + 1)
      ? []
      : index % 4 === 3
        ? ["--aot-heat=everything-is-hot"]
        : index % 4 === 2
          ? ["--aot-heat=everything-is-cold"]
          : [],
    make: () => ({ file: "main.js", text: generate(new Random(index + 1), onceWrong.includes(index + 1)) }),
  })),
);
