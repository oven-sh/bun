import { beginnings, program } from "./generated/optional-numbers-in-loops";
import { generated } from "./generated/run-generated";

generated(
  "optional numbers in loops",
  beginnings.flatMap(beginning =>
    [true, false].flatMap(isArrayWritten =>
      [false, true].map(isTypeScript => ({
        name: `${beginning} the array is ${isArrayWritten ? "written in the function" : "handed in"}, ${isTypeScript ? "TypeScript" : "JavaScript"}`,
        isAlwaysRun: !isTypeScript && (beginning === "let x;" || beginning === "let x = null;"),
        make: () => program(beginning, isArrayWritten, isTypeScript),
      })),
    ),
  ),
);
