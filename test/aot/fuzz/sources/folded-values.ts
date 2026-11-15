// A list of programs from ../generators/folded-values.ts, which describes them.
import { program } from "../generators/folded-values";
import { family } from "../family";

export default family(
  "folded values",
  Array.from({ length: 24 }, (_, index) => index + 1).flatMap(seed =>
    [false, true].map(isTypeScript => ({
      name: `seed ${seed}, ${isTypeScript ? "TypeScript" : "JavaScript"}`,
      make: () => program(seed, isTypeScript),
    })),
  ),
);
