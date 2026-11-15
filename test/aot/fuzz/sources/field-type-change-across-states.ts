// A fixed list of seeds of ../field-type-change-across-states.ts, which describes the programs.
import { generate } from "../field-type-change-across-states";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "field type change across states",
  Array.from({ length: 480 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // The point is what the run time caches about the objects of one program.
    isBuiltAlone: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
