// A list of programs from ../entry-points-by-computed-name.ts, which describes them.
import { everyProgram } from "../entry-points-by-computed-name";
import { family } from "../family";

export default family(
  "entry points by computed name",
  everyProgram().map(({ name, ...program }, index) => ({
    name: `${name}.`,
    make: () => program,
  })),
);
