import { programsOf } from "./generated/case-files";
import {
  membersDefinedOverAnEarlierValue,
  membersGivenUnknownValues,
} from "./generated/members-defined-over-an-earlier-value";
import { generated } from "./generated/run-generated";

generated(
  "a member is defined over an earlier value of the same name",
  programsOf(membersDefinedOverAnEarlierValue(), { alone: 120 }),
);
generated(
  "a member is given a value that the build knows nothing about",
  programsOf(membersGivenUnknownValues(), { alone: 40 }),
);
