import { generated } from "./generated/run-generated";
import { columnKinds, program, wideColumnCounts, wideProgram } from "./generated/sql-typed-rows";

generated("typed SQL rows", [
  ...columnKinds.map(kind => ({ name: kind, isAlwaysRun: true, make: () => program(kind) })),
  ...wideColumnCounts.map(count => ({ name: `${count} columns`, isAlwaysRun: true, make: () => wideProgram(count) })),
]);
