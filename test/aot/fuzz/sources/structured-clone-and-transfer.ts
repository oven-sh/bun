// A fixed list of seeds of ../structured-clone-and-transfer.ts, which describes the programs.
import { Random } from "../random";
import { corners, generate } from "../structured-clone-and-transfer";
import { family } from "../family";

export default family(
  "structured clone and transfer",
  corners.map((corner, index) => {
    const isErased = index % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      make: () => generate(new Random(index + 1), corner),
    };
  }),
);
