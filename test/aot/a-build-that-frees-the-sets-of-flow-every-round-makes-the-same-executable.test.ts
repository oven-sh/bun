// Whole-program analysis frees the sets that nobody holds any more once they have grown by half. Whoever holds a set has to be listed where they are freed (ValueFlowSolver::freeSetsThatNobodyHolds()):
// a holder that is missing there names a set that is gone, or another set that has taken its number. freeAOTFlowSetsEveryRound frees after every round, so that a small program meets what only a large one
// meets otherwise. The executable must be the same, byte for byte, and a Bun with assertions stops at the first read of a freed set.
import { afterAll, expect } from "bun:test";
import { mkdirSync, readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned, withoutDebugInformation } from "./harness/commands";
import { compileCommand } from "./harness/flags";
import { describe, test } from "./supported";

const programs = [
  "parallel/objects/functions-that-make-makers-of-objects.js",
  "parallel/objects/makers-of-makers-that-other-modules-call/main.ts",
];

describe.concurrent("compile/aot/a build that frees the sets of flow every round makes the same executable", () => {
  const root = String(tempDir("aot-sets-freed-every-round", {}));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test.each(programs)(
    "%s",
    async program => {
      const executables: Buffer[] = [];
      const folder = join(root, String(programs.indexOf(program)));
      mkdirSync(folder);
      for (const env of [bunEnv, { ...bunEnv, BUN_JSC_freeAOTFlowSetsEveryRound: "1" }]) {
        // One path for both: the executable may hold its own name.
        const executable = join(folder, isWindows ? "program.exe" : "program");
        rmSync(executable, { force: true });
        built(
          await spawned(
            [
              bunExe(),
              ...compileCommand,
              ...withoutDebugInformation(),
              join(import.meta.dir, program),
              "--outfile",
              executable,
            ],
            root,
            env,
          ),
        );
        executables.push(readFileSync(executable));
      }
      expect(executables[0]!.length).toBe(executables[1]!.length);
      expect(executables[0]!.equals(executables[1]!)).toBe(true);
    },
    600_000,
  );
});
