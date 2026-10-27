import { programsOf } from "./generated/case-files";
import { caseFiles } from "./generated/nested-counted-loops-over-lists";
import { generated } from "./generated/run-generated";

generated("counted loops inside counted loops over lists", programsOf(caseFiles(false), { alone: 60 }));
generated("counted loops inside counted loops over typed lists", programsOf(caseFiles(true), { alone: 30 }));
