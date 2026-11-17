// For a test file that asks something of the executable's file: ./program-alone.ts lists them.
import { bunEnv } from "harness";
import "./program-alone";

delete bunEnv.BUN_AOT_WRITES_PROGRAM_ALONE;
