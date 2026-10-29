// A fixed list of seeds of ../native-object-members-across-files.ts, which describes the programs.
import { corners, generate } from "../native-object-members-across-files";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "native object members across files",
  Array.from({ length: corners.length * 8 }, (_, index) => {
    const corner = corners[index % corners.length];
    const isErased = (index + Math.floor(index / corners.length)) % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      make: () => generate(new Random(index + 1), corner),
    };
  }),
);
