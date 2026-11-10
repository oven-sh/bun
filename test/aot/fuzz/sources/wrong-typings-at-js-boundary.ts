// A fixed list of seeds of ../wrong-typings-at-js-boundary.ts, which describes the programs.
import { corners, generate } from "../wrong-typings-at-js-boundary";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "wrong typings at js boundary",
  Array.from({ length: corners.length * 80 }, (_, index) => {
    const corner = corners[index % corners.length];
    // The number of corners is a multiple of three, so the offset shifts by one with every row.
    const isErased = (index + Math.floor(index / corners.length)) % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      // The second half is sampled more densely, and half of its members are one level deeper.
      make: () => generate(new Random(index + 1), corner, index >= corners.length * 40),
    };
  }),
);
