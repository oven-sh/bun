// A fixed list of seeds of ../default-member-commonjs-esm-interop.ts, which describes the programs.
import { Random } from "../random";
import { corners, generate } from "../default-member-commonjs-esm-interop";
import { family } from "../family";

export default family(
  "default member commonjs esm interop",
  Array.from({ length: corners.length * 24 }, (_, index) => {
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
