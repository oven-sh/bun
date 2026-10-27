import { programsOf } from "./generated/case-files";
import { caseFiles as rows } from "./generated/loops-whose-counter-is-set-from-the-loop-inside";
import { caseFiles } from "./generated/nested-counted-loops-over-lists";
import { generated } from "./generated/run-generated";

generated("counted loops inside counted loops over lists", programsOf(caseFiles(false), { alone: 60 }));
generated("counted loops inside counted loops over typed lists", programsOf(caseFiles(true), { alone: 30 }));
generated("a loop over a list sets its counter from the loop inside", programsOf(rows(false), { alone: 16 }));
generated("a loop over a typed list sets its counter from the loop inside", programsOf(rows(true), { alone: 8 }));
