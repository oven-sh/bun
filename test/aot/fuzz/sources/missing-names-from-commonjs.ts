// A fixed list of seeds of ../missing-names-from-commonjs.ts, which describes the programs.
import { generate } from "../missing-names-from-commonjs";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "missing names from commonjs",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    make: () => generate(new Random(index + 1)),
  })),
);
