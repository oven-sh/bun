// A fixed list of seeds of ../typescript-only-class-members.ts, which describes the programs.
import { generate, options } from "../typescript-only-class-members";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "typescript only class members",
  Array.from({ length: 120 }, (_, index) => {
    // Programs share an executable with those that have the same tsconfig.json, so the options come in runs of six.
    const option = options[Math.floor(index / 6) % options.length];
    return {
      name: `seed ${index + 1}, a field ${option}.`,
      make: () => ({ file: "main.ts", ...generate(new Random(index + 1), option) }),
    };
  }),
);
