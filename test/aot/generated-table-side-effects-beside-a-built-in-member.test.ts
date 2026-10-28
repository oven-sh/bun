import { programsOf } from "./generated/case-files";
import { generated } from "./generated/run-generated";
import { caseFiles } from "./generated/side-effects-beside-a-built-in-member";

generated(
  "an expression whose value is a member of a built-in object does what else it says",
  programsOf(caseFiles(), { alone: 96 }),
);
