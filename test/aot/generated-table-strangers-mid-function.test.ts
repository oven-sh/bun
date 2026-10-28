import { programsOf } from "./generated/case-files";
import { generated } from "./generated/run-generated";
import { caseFiles } from "./generated/strangers-mid-function";

generated(
  "a typed function meets an object of another kind in the middle of its body",
  programsOf(caseFiles(), {
    alone: 200,
    // A number is refused where a class is declared, before the body is entered.
  }),
);
