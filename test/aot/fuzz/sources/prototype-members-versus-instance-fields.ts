// A fixed list of seeds of ../prototype-members-versus-instance-fields.ts, which describes the programs.
import { Random } from "../random";
import { generate } from "../prototype-members-versus-instance-fields";
import { family } from "../family";

export default family(
  "prototype members versus instance fields",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    make: () => ({
      file: index % 3 === 0 ? "main.cjs" : "main.mjs",
      text: generate(new Random(index + 1)),
    }),
  })),
);
