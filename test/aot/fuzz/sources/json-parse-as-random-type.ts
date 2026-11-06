// A list of programs from ../generators/json-parse-as-random-type.ts, which describes them.
import { tsconfig } from "../generators/object-inspection-helpers";
import { family } from "../family";
import { program } from "../generators/json-parse-as-random-type";

export default family(
  "json parse as random type",
  Array.from({ length: 200 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    make: () => ({ file: "main.ts", text: program(index + 1), files: { "tsconfig.json": tsconfig } }),
  })),
);
