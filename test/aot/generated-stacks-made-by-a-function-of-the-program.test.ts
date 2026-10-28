import { generated } from "./generated/run-generated";
import { combinations, nameOf, textOf } from "./generated/stacks-made-by-a-function-of-the-program";
import { schedules } from "./harness/flow-schedules";

generated(
  "the stack of an error is made by a function of the program",
  combinations.flatMap(combination =>
    Object.entries(schedules).map(([schedule, flags]) => ({
      name: `${nameOf(combination)}, the ${schedule} schedule`,
      isAlwaysRun:
        schedule === "usual" &&
        combination.isLate &&
        combination.isStoredBack &&
        combination.errorClass === "TypeError",
      isOnlyCompiled: true as const,
      flags,
      make: () => ({ file: "main.mjs", text: textOf(combination) }),
    })),
  ),
);
