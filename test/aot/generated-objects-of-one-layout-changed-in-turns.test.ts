import { tsconfig } from "./generated/every-way-to-look-at-an-object";
import { program } from "./generated/objects-of-one-layout-changed-in-turns";
import { generated } from "./generated/run-generated";

generated(
  "objects of one layout answer alike after changes to one of them",
  Array.from({ length: 400 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    isAlwaysRun: index < 6,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.ts", text: program(index + 1), files: { "tsconfig.json": tsconfig } }),
  })),
);
