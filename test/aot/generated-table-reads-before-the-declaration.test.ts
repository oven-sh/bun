import { programsOf } from "./generated/case-files";
import { caseFiles } from "./generated/reads-before-the-declaration";
import { generated } from "./generated/run-generated";

generated("a binding is read before its declaration has run", programsOf(caseFiles(), { alone: 200 }));
