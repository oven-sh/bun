import { generated } from "./generated/run-generated";
import { program } from "./generated/small-functions";

generated(
  "small functions",
  Array.from({ length: 40 }, (_, i) =>
    [false, true].map(isTypeScript => ({
      name: `seed ${i + 1}, ${isTypeScript ? "TypeScript" : "JavaScript"}`,
      isAlwaysRun: i < 2,
      make: () => program(i + 1, isTypeScript),
    })),
  ).flat(),
);
