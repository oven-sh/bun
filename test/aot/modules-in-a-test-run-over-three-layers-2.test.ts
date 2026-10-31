// The projects, and what they are for: ./harness/modules-in-a-test-run.ts.
import { declareEveryProject } from "./harness/modules-in-a-test-run";

declareEveryProject("over three layers", import.meta.path);
