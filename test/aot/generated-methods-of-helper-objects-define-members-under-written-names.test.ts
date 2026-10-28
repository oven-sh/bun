// Fixed seeds of fuzz/methods-of-helper-objects-define-members-under-written-names.ts: a method of a helper object defines closures on a
// target under the keys it is handed. The members of the target, their names, lengths and results, and which of them are one closure, are
// those of plain Bun, also after the method was replaced.
import { generate } from "./fuzz/methods-of-helper-objects-define-members-under-written-names";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

// Every run takes these, whatever else it takes.
const onceWrong = [8, 21, 25, 49, 52, 85, 98, 101, 144, 158];

generated(
  "closures that a method of a helper object defines under written names are those of plain Bun",
  Array.from({ length: 160 }, (_, index) => ({
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
    make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
  })),
);
