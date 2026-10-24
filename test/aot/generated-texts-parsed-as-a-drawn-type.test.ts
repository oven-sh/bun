import { tsconfig } from "./generated/every-way-to-look-at-an-object";
import { generated } from "./generated/run-generated";
import { program } from "./generated/texts-parsed-as-a-drawn-type";

generated(
  "text parsed as a type gives what plain JSON.parse gives",
  Array.from({ length: 200 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    isAlwaysRun: index < 4,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.ts", text: program(index + 1), files: { "tsconfig.json": tsconfig } }),
  })),
);
