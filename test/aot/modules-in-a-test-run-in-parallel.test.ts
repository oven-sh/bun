// The projects, and what they are for: ./harness/modules-in-a-test-run.ts.
import { declareEveryProject } from "./harness/modules-in-a-test-run";

declareEveryProject("in parallel", import.meta.path);
