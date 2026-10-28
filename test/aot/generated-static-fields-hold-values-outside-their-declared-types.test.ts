// Fixed seeds of fuzz/static-fields-hold-values-outside-their-declared-types.ts: a static field of an enum, of a union of number literals, or of
// one of these or undefined, null or a string is stored values that TypeScript lets in and the type leaves out. Every read of the field gives what
// it gives in plain Bun, before and after each store. Every fifth seed has the class, the reads and the stores in three modules.
import { Random } from "./fuzz/random";
import { generateFiles } from "./fuzz/static-fields-hold-values-outside-their-declared-types";
import { generated } from "./generated/run-generated";

// Every run takes these, whatever else it takes.
const onceWrong = [29, 73, 74, 86, 118, 151, 158, 169, 176, 177, 202];

generated(
  "static fields that hold values outside their declared types read as in plain Bun",
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
    make: () => {
      const { text, files } = generateFiles(new Random(index + 1), (index + 1) % 5 === 0);
      return { file: "main.ts", text, files };
    },
  })),
);
