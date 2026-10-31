// Fixed seeds of fuzz/parameters-of-every-form-read-behind-suspensions.ts: functions that suspend take parameters of every form, store to them in front of, between and
// behind the suspensions, straight on, on one path, in a loop, through a closure or through `arguments`, and read them again. Every second file is not strict.
import { generate } from "../parameters-of-every-form-read-behind-suspensions";
import { Random } from "../random";
import { family } from "../family";

export default family("parameters hold behind a suspension what they hold in plain Bun", [
  ...Array.from({ length: 200 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    flags:
      index % 8 === 5 ? ["--aot-heat=everything-is-hot"] : index % 8 === 6 ? ["--aot-heat=everything-is-cold"] : [],
    make: () =>
      index % 2 === 1
        ? { file: "main.cjs", text: generate(new Random(index + 1), true) }
        : { file: "main.js", text: generate(new Random(index + 1)) },
  })),
]);
