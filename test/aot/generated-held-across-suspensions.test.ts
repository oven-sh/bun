import { testPrograms, tsconfig } from "./generated/held-across-suspensions";
import { generated } from "./generated/run-generated";

generated(
  "a function that waits holds a value that nothing else holds",
  testPrograms().map(({ name, text }, index) => ({
    name: `${name}.`,
    isAlwaysRun: index % 2 === 0,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.ts", text, files: { "tsconfig.json": tsconfig } }),
  })),
);
