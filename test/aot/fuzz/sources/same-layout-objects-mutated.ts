// A list of programs from ../generators/same-layout-objects-mutated.ts, which describes them.
import { tsconfig } from "../generators/object-inspection-helpers";
import { program } from "../generators/same-layout-objects-mutated";
import { family } from "../family";

export default family(
  "same layout objects mutated",
  Array.from({ length: 400 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    make: () => ({ file: "main.ts", text: program(index + 1), files: { "tsconfig.json": tsconfig } }),
  })),
);
