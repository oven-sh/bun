import { programsOf } from "./generated/case-files";
import { generated } from "./generated/run-generated";
import { caseFiles } from "./generated/walks-over-every-kind-of-operand";

generated("whatever walks an operand asks it what the language says", programsOf(caseFiles(), { alone: 128 }));
