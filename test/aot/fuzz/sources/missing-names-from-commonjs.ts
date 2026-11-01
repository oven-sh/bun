// A fixed list of seeds of ../missing-names-from-commonjs.ts, which describes the programs.
import { generate } from "../missing-names-from-commonjs";
import { Random } from "../random";
import { family } from "../family";

const onceWrong = [8, 12, 18, 45, 62, 71, 79, 88, 89, 91, 97, 103, 111, 114, 132, 136, 171, 183, 198];

export default family(
  "missing names from commonjs",
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
