// Fixed seeds of fuzz/names-taken-from-commonjs-files-that-may-lack-them.ts: an ES module or a TypeScript module takes names from a CommonJS file,
// directly or through modules that hand them on, and the file stores the names in many ways, late, or never. The same files run in the same order,
// each name holds the same, and a program in which a name is missing ends as it ends in plain Bun.
import { generate } from "../names-taken-from-commonjs-files-that-may-lack-them";
import { Random } from "../random";
import { family } from "../family";

const onceWrong = [8, 12, 18, 45, 62, 71, 79, 88, 89, 91, 97, 103, 111, 114, 132, 136, 171, 183, 198];

export default family(
  "names taken from CommonJS files that may lack them are missed as in plain Bun",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
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
