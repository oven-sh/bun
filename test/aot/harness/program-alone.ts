// Most tests of test/aot build an executable only to run it. With AOT_PROGRAMS_ALONE=1 around a run on Linux their builds write the program without
// a copy of Bun around it (BUN_AOT_WRITES_PROGRAM_ALONE: src/runtime/cli/run_compiled.rs): a few MB in place of the size of Bun. The compile is the
// same, the file starts as it stands, and from there on Bun boots as the executable does.
//
// It is off unless asked for: it was on for half an hour, and files that read the executable's sections or ask what it leaves out turned red on Buns
// that can trim and have the engine's tools beside them, which the Bun that the files had been tried on could not. The stored programs of
// ./parallel have it on (run-parallel.ts): all of them were run both ways.
//
// The files that import ./real-executables build an executable whatever is asked for, because they ask something of the file, of how it is mapped, or of
// what a start needs. So does a build for another target, from another Bun, with --trim, --aot-symbols or obfuscation.
import { bunEnv, isLinux } from "harness";

if (isLinux && process.env.AOT_PROGRAMS_ALONE) bunEnv.BUN_AOT_WRITES_PROGRAM_ALONE = "1";
