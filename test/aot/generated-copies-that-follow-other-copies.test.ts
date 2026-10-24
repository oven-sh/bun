import { program } from "./generated/copies-that-follow-other-copies";
import { tsconfig } from "./generated/every-way-to-look-at-an-object";
import { generated } from "./generated/run-generated";

generated(
  "a copy is the same whatever was copied before it",
  Array.from({ length: 200 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    isAlwaysRun: index < 4,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.ts", text: program(index + 1), files: { "tsconfig.json": tsconfig } }),
  })),
);
