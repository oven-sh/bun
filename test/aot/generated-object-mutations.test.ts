import { testPlanes } from "./generated/object-mutations";
import { generated } from "./generated/run-generated";

generated(
  "an object is changed behind the code that uses it",
  testPlanes().flatMap(({ title, alwaysRun, programs }) =>
    programs.map(({ name, text }) => ({
      name: `${name}, ${title}.`,
      isAlwaysRun: alwaysRun.includes(name),
      make: () => ({ file: "main.js", text }),
    })),
  ),
);
