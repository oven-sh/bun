// A fixed list of seeds of ../library-object-members-by-key.ts, which describes the programs.
import { corners, generate } from "../library-object-members-by-key";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "library object members by key",
  corners.map((corner, index) => {
    const isErased = index % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      make: () => generate(new Random(index + 1), corner),
    };
  }),
);
