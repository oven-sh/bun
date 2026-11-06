// A fixed list of seeds of ../near-compiler-reexport-descriptors.ts, which describes the programs.
import { corners, generate } from "../near-compiler-reexport-descriptors";
import { Random } from "../random";
import { family } from "../family";

const overCommonJS = corners.length * 10;
const overAnESModule = corners.length * 4;

export default family(
  "near compiler reexport descriptors",
  Array.from({ length: overCommonJS + overAnESModule }, (_, index) => {
    const corner = corners[index % corners.length];
    // In the last seeds the dependency is an ES module.
    const isOverAnESModule = index >= overCommonJS;
    const isErased = index % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isOverAnESModule ? ", over an ES module" : ""}${isErased ? ", types erased" : ""}.`,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      make: () => generate(new Random(index + 1), corner, isOverAnESModule),
    };
  }),
);
