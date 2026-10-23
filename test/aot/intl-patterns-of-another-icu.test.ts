// An executable may run with another ICU than the one that made its format patterns (test/aot/intl-fuzz/README.md). The programs
// about constant formatters print what plain Bun prints as built, with every pattern planned again by the ICU that runs, and with
// every plan refused, when ICU formats everything.
// The compiler makes no format patterns today: ICU formats everything at run time, and the option that these tests set does not exist.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const programs = join(import.meta.dir, "programs", "calls-fast-paths");
const names = [
  "intl-constant-formatters",
  "intl-constant-formatters-in-every-flow",
  "intl-constant-formatters-known-traps",
  "intl-constant-formatters-when-the-time-zone-changes",
  "to-locale-string-with-constant-arguments",
];
const ways = { "as built": "0", "planned again": "1", "no plan": "2" };

for (const name of names) {
  test.todo(
    `${name} prints the same whichever ICU made its patterns`,
    async () => {
      using dir = tempDir("aot-patterns-of-another-icu", {});
      const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", join(programs, name + ".ts"), "--outfile", executable],
        String(dir),
        bunEnv,
      );
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      const plain = await run([bunExe(), "run", join(programs, name + ".ts")], String(dir), bunEnv);
      expect(plain.exitCode).toBe(0);
      for (const [way, value] of Object.entries(ways)) {
        const ran = await run([executable], String(dir), {
          ...bunEnv,
          BUN_JSC_formatPatternsOfAnotherICUForTesting: value,
        });
        expect({ way, ...ran }).toEqual({ way, ...plain });
      }
    },
    300_000,
  );
}
