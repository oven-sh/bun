import { generated } from "./generated/run-generated";
import { columnKinds, program } from "./generated/sql-typed-rows";

generated(
  "typed SQL rows",
  columnKinds.map(kind => ({ name: kind, isAlwaysRun: true, make: () => program(kind) })),
);
