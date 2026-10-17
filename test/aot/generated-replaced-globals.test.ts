import { program, spellings, targets } from "./generated/replaced-globals";
import { generated } from "./generated/run-generated";

const inEverySpelling = new Set(["globalThis.Date", "Math.floor", "globalThis.fetch"]);

generated(
  "replaced globals",
  targets.flatMap(target =>
    spellings.map(spelling => ({
      name: `${target.holder}.${target.name} by ${spelling}`,
      isAlwaysRun: spelling === "dot" || inEverySpelling.has(`${target.holder}.${target.name}`),
      mayBeRefused: true as const,
      make: () => program(target, spelling),
    })),
  ),
);
