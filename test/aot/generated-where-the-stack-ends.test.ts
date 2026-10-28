import { generated } from "./generated/run-generated";
import { testPrograms, tsconfig } from "./generated/where-the-stack-ends";

generated(
  "a recursion reaches the end of the stack and the program goes on",
  testPrograms().map(({ name, text }, index) => ({
    name: `${name}.`,
    isAlwaysRun: index % 2 === 0,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.ts", text, files: { "tsconfig.json": tsconfig } }),
  })),
);
