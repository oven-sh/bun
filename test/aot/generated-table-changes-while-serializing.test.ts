import { programsOf } from "./generated/case-files";
import { caseFiles } from "./generated/changes-while-serializing";
import { generated } from "./generated/run-generated";

generated("a value changes its holder while JSON.stringify writes it", programsOf(caseFiles(), { alone: 200 }));
