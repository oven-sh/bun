// Every program of fuzz/entry-points-loaded-by-computed-names.ts: a file that is another entry point of the build is loaded by a name that is put
// together at run time, and the executable prints what plain Bun prints.
import { everyProgram } from "../entry-points-loaded-by-computed-names";
import { family } from "../family";

export default family(
  "entry points are loaded by computed names",
  everyProgram().map(({ name, ...program }, index) => ({
    name: `${name}.`,
    make: () => program,
  })),
);
