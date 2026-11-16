// A fixed list of seeds of ../descriptors-copied-across-files.ts, which describes the programs.
import { corners, generate } from "../descriptors-copied-across-files";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "descriptors copied across files",
  corners.map((corner, index) => {
    const isErased = index % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      make: () => generate(new Random(index + 1), corner),
    };
  }),
);
