import { programsOf } from "./generated/case-files";
import { caseFiles } from "./generated/presence-of-stored-properties";
import { generated } from "./generated/run-generated";

generated("a property that was just stored is there", programsOf(caseFiles(false), { alone: 150 }));
generated("a property that typed code has just stored is there", programsOf(caseFiles(true), { alone: 100 }));
