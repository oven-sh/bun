import { programsOf } from "./generated/case-files";
import { membersDefinedOverAnEarlierValue } from "./generated/members-defined-over-an-earlier-value";
import { generated } from "./generated/run-generated";

generated(
  "a member is defined over an earlier value of the same name",
  programsOf(membersDefinedOverAnEarlierValue(), { alone: 120 }),
);
