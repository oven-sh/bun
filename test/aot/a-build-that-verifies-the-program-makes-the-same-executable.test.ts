// Every build that Bun's own tests make verifies the program between the stages of the compiler (bunEnv has BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING). A user's build does not. The tests judge what users get
// only if the two builds make the same executable, byte for byte.
import { afterAll, expect } from "bun:test";
import { mkdirSync, readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned, withoutDebugInformation } from "./harness/commands";
import { compileCommand } from "./harness/flags";
import { describe, test } from "./supported";

const programs = [
  // A function that makes makers of objects, each below a prototype object of its own.
  "parallel/objects/functions-that-make-makers-of-objects.js",
  "parallel/objects/makers-of-makers-that-other-modules-call/main.ts",
  "perf/idioms/function/makers-made-by-one-function-each-with-its-own-prototype.ts",
  "parallel/objects/method-called-field-type-names-class.ts",
];

describe.concurrent("compile/aot/a build that verifies the program makes the same executable", () => {
  const root = String(tempDir("aot-verified-and-not", {}));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test.each(programs)(
    "%s",
    async program => {
      const { BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: _, ...asUsersHaveIt } = bunEnv;
      const executables: Buffer[] = [];
      const folder = join(root, String(programs.indexOf(program)));
      mkdirSync(folder);
      for (const env of [bunEnv, asUsersHaveIt]) {
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
