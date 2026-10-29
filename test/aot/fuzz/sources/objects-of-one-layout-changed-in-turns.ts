import { tsconfig } from "../generators/every-way-to-look-at-an-object";
import { program } from "../generators/objects-of-one-layout-changed-in-turns";
import { family } from "../family";

export default family(
  "objects of one layout answer alike after changes to one of them",
  Array.from({ length: 400 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    make: () => ({ file: "main.ts", text: program(index + 1), files: { "tsconfig.json": tsconfig } }),
  })),
);
