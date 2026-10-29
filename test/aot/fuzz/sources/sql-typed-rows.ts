import { family } from "../family";
import { columnKinds, program, wideColumnCounts, wideProgram } from "../generators/sql-typed-rows";

export default family("typed SQL rows", [
  ...columnKinds.map(kind => ({ name: kind, make: () => program(kind) })),
  ...wideColumnCounts.map(count => ({ name: `${count} columns`, make: () => wideProgram(count) })),
]);
