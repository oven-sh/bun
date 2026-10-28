import { programsOf } from "./generated/case-files";
import { caseFiles } from "./generated/repeated-reads";
import { generated } from "./generated/run-generated";

generated("a value is read again after other code ran", programsOf(caseFiles(false), { alone: 150 }));
generated(
  "a value is read again through a typed reference after other code ran",
  programsOf(caseFiles(true), { alone: 50 }),
);
