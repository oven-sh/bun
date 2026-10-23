import { testPrograms } from "./generated/many-of-one-thing";
import { generated } from "./generated/run-generated";

generated(
  "a program has very many of one thing",
  testPrograms().map(({ name, text }, index) => ({
    name: `${name}.`,
    isAlwaysRun: index % 3 === 0,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.js", text }),
  })),
);
