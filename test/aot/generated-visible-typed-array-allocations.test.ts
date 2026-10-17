import { generated } from "./generated/run-generated";
import { known, program } from "./generated/visible-typed-array-allocations";

generated(
  "typed arrays whose birth is in sight",
  known.flatMap(how =>
    [false, true].map(isTypeScript => ({
      name: `what it is made of is ${how}, ${isTypeScript ? "TypeScript" : "JavaScript"}`,
      isAlwaysRun: isTypeScript ? how === "written" : how === "a parameter",
      make: () => program(how, isTypeScript),
    })),
  ),
);
