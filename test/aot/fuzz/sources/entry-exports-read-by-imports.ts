// A fixed list of seeds of ../entry-exports-read-by-imports.ts, which describes the programs.
import { corners, generate } from "../entry-exports-read-by-imports";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "entry exports read by imports",
  Array.from({ length: corners.length * 20 }, (_, index) => {
    const corner = corners[index % corners.length];
    // The number of corners is a multiple of three, so the offset shifts by one with every row.
    const isErased = (index + Math.floor(index / corners.length)) % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      make: () => generate(new Random(index + 1), corner),
    };
  }),
);
