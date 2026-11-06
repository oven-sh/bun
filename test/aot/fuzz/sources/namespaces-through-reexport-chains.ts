// A fixed list of seeds of ../namespaces-through-reexport-chains.ts, which describes the programs.
import { generate } from "../namespaces-through-reexport-chains";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "namespaces through reexport chains",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // This program ends with an uncaught error.
    ...(index + 1 === 72 ? {} : {}),
    make: () => generate(new Random(index + 1)),
  })),
);
