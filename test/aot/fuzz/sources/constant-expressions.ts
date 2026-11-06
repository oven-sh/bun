// Expressions that the compiler can work out while it builds, in every language and at every seed.
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
