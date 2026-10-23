import { generated } from "./generated/run-generated";
import { testPlanes, tsconfig } from "./generated/typed-object-mutations";

generated(
  "an object is changed behind a typed reference",
  testPlanes().flatMap(({ title, alwaysRun, programs }) =>
    programs.map(({ name, text }) => ({
      name: `${name}, ${title}.`,
      isAlwaysRun: alwaysRun.includes(name),
      make: () => ({ file: "main.ts", text, files: { "tsconfig.json": tsconfig } }),
    })),
  ),
);
