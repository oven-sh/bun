// Fixed seeds of fuzz/names-taken-from-commonjs-files-that-may-lack-them.ts: an ES module or a TypeScript module takes names from a CommonJS file,
// directly or through modules that hand them on, and the file stores the names in many ways, late, or never. The same files run in the same order,
// each name holds the same, and a program in which a name is missing ends as it ends in plain Bun.
import { generate } from "./fuzz/names-taken-from-commonjs-files-that-may-lack-them";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

// Every run takes these, whatever else it takes.
const onceWrong = [8, 12, 18, 45, 62, 71, 79, 88, 89, 91, 97, 103, 111, 114, 132, 136, 171, 183, 198];

generated(
  "names taken from CommonJS files that may lack them are missed as in plain Bun",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first eight seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 8,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    exitsAsPlainBunDoes: true as const,
    flags: onceWrong.includes(index + 1)
      ? []
      : index % 4 === 3
        ? ["--aot-heat=everything-is-hot"]
        : index % 4 === 2
          ? ["--aot-heat=everything-is-cold"]
          : [],
    make: () => generate(new Random(index + 1)),
  })),
);
