// The code that is compiled ahead of time for a regular expression compares several characters at once with a constant. Where the program
// puts the source of the expression together while it runs, those constants must not lie side by side in the executable and spell it.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./run-programs";

const sources = {
  "entry.ts": `
let source = "";
for (const piece of ["sixteen", "Letters", "Ab"]) source += piece;
const expression = new RegExp(source + "[0-9]+");
const spelled = /thisOneIsSpelled[0-9]+/;
console.log(expression.test(source + "1"), expression.test(source), expression.test("x" + source + "22y"), spelled.test("thisOneIsSpelled3"));
`,
};

describe.skipIf(!!unsupported)("compile/aot/assembled-patterns-in-code", () => {
  const folder = String(tempDir("aot-assembled-patterns-in-code", sources));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  // TODO: the source that the build puts together is in the executable as one text.
  test.todo(
    "the constants of a run of characters do not spell a source that only the running program spells",
    async () => {
      await slot(async () => {
        const executable = join(folder, isWindows ? "compiled.exe" : "compiled");
        built(
          await spawned(
            [
              bunExe(),
              "build",
              "--compile",
              "--aot",
              "--minify",
              "--no-compile-function-source",
              "./entry.ts",
              "--outfile",
              executable,
            ],
            folder,
            bunEnv,
          ),
        );
        const run = await spawned([executable], folder, bunEnv);
        const bytes = readFileSync(executable);
        rmSync(executable);
        expect(run.stdout).toBe("true false true true\n");
        expect(bytes.includes("thisOneIsSpelled", 0, "latin1")).toBe(true);
        expect(bytes.includes("sixteenLettersAb", 0, "latin1")).toBe(false);
      });
    },
    600_000,
  );
});
