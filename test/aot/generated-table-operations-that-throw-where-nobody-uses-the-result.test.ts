import { programsOf } from "./generated/case-files";
import { caseFiles } from "./generated/operations-that-throw-where-nobody-uses-the-result";
import { generated } from "./generated/run-generated";

generated("an operation throws wherever it stands, wanted or not", programsOf(caseFiles(), { alone: 120 }));
