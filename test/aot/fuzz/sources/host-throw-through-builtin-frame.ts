// A fixed list of seeds of ../host-throw-through-builtin-frame.ts, which describes the programs.
import { Random } from "../random";
import { generate } from "../host-throw-through-builtin-frame";
import { family } from "../family";

export default family(
  "host throw through builtin frame",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    make: () => generate(new Random(index + 1)),
  })),
);
