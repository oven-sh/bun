// A list of programs from ../generators/constant-expressions.ts, which describes them.
import { program } from "../generators/constant-expressions";
import { family } from "../family";

export default family(
  "constant expressions",
  Array.from({ length: 96 }, (_, index) => index + 1).flatMap(seed =>
    [false, true].map(isTypeScript => ({
      name: `seed ${seed}, ${isTypeScript ? "TypeScript" : "JavaScript"}`,
      make: () => program(seed, isTypeScript),
    })),
  ),
);
