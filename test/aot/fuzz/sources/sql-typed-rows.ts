// A list of programs from ../generators/sql-typed-rows.ts, which describes them.
import { family } from "../family";
import { columnKinds, program, wideColumnCounts, wideProgram } from "../generators/sql-typed-rows";

export default family("sql typed rows", [
  ...columnKinds.map(kind => ({ name: kind, make: () => program(kind) })),
  ...wideColumnCounts.map(count => ({ name: `${count} columns`, make: () => wideProgram(count) })),
]);
