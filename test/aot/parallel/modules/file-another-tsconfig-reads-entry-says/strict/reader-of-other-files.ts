import { OWN, PASSED_ON } from "../passes-on.ts";

export const describeThroughOtherFiles = (): string => (PASSED_ON ? "main" : "not main") + ", " + (OWN ? "main" : "not main");
