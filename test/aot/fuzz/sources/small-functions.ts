// A list of programs from ../generators/small-functions.ts, which describes them.
import { family } from "../family";
import { program } from "../generators/small-functions";

export default family(
  "small functions",
  Array.from({ length: 40 }, (_, i) =>
    [false, true].map(isTypeScript => ({
      name: `seed ${i + 1}, ${isTypeScript ? "TypeScript" : "JavaScript"}`,
      make: () => program(i + 1, isTypeScript),
    })),
  ).flat(),
);
