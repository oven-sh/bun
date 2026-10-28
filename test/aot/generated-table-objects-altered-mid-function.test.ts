import { programsOf } from "./generated/case-files";
import { caseFiles } from "./generated/objects-altered-mid-function";
import { generated } from "./generated/run-generated";

generated(
  "an object is altered between the two halves of a typed function",
  programsOf(caseFiles(), {
    alone: 100,
    failsToday: [
      {
        cases: /^interface-over-a-class method-hidden-by-a-text(-assigned)? /,
        how: "A text is stored over the method of an instance that is typed by an interface. The call of the method crashes the executable.",
      },
    ],
  }),
);
