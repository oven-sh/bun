// Runs ../answers and ../from-source: tests of the engine that hold a program and no records.
// A file of ../answers has the head of an IR test of the engine and a small program that tells its answers. A file of ../from-source is an IR test
// of which only the comments are kept: they hold its program, between `# -- source:` and `# -- end of source`, and its check lines.
// The records are made with the front end of the Bun under test (../tools/answers-test-from-source.ts, ../tools/update-ir-tests.ts).
// Then `testaot run` does what the head says: it holds what `walk`, `link` or `plan` print against the check lines; it builds a program that tells
// its answers, runs it in the shell, has the shell run the text itself, and compares answer by answer.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { slot } from "../harness/commands";
import { expectNoTestFails, skipOrFail, whyNoShell } from "./testaot";

// `--mechanisms=none`, say: then only the run in the shell runs, on code that no mechanism has touched.
const moreFlags = (process.env.AOT_ANSWERS_FLAGS ?? "").split(" ").filter(Boolean);

// bun:test ends the processes of a case that reaches its limit only where no case runs beside it. So a tool that hangs is ended here,
// before the limit of its case, and the signal fails the case. `testaot run` ends what it starts itself.
const limitOfACase = 600_000;
const limitOfATool = 540_000;

export const answersTests = (part: number, parts: number) =>
  testsMadeOf(
    "answers",
    ["answers-test-from-source.ts", "--stored"],
    /\.(ts|js|mjs)$/,
    "programs that tell their answers",
    part,
    parts,
  );

export const fromSourceTests = (part: number, parts: number) =>
  testsMadeOf(
    "from-source",
    ["update-ir-tests.ts", "--print-anew"],
    /\.ir$/,
    "tests that hold their source",
    part,
    parts,
  );

/**
 * Every `parts`-th file of the folder, from the `part`-th on, each a case of its own. A new file needs no list: it is in one of the parts.
 * A case makes its test and runs it at once, by itself: `testaot run` hands sixteen files that follow one another to a process, which runs
 * them one after another, and a test that holds much of the library takes as long as a hundred others.
 */
function testsMadeOf(folderName: string, tool: string[], isTest: RegExp, title: string, part: number, parts: number) {
  if (whyNoShell) return void skipOrFail(whyNoShell);
  const folder = join(import.meta.dir, "..", folderName);
  const mine = readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter(name => isTest.test(name))
    .map(name => name.replaceAll("\\", "/"))
    .sort()
    .filter((_, index) => index % parts === part - 1);
  describe(`${mine.length} ${title}`, () => {
    let passed = 0;
    for (const name of mine)
      test.concurrent(
        name,
        () =>
          slot(async () => {
            await using child = Bun.spawn({
              cmd: [bunExe(), join(import.meta.dir, "..", "tools", tool[0]), tool[1], join(folder, name)],
              env: bunEnv,
              stdin: "ignore",
              stdout: "pipe",
              stderr: "pipe",
              timeout: limitOfATool,
              killSignal: "SIGKILL",
            });
            const [text, stderr, exitCode] = await Promise.all([
              child.stdout.text(),
              child.stderr.text(),
              child.exited,
            ]);
            // A file of which no test could be made has not been tested. The tool says on stderr what stood in the way, and also that an id
            // in the text names no record: `testaot run` does not read such a text.
            expect({
              stderr: stderr.slice(-600),
              exitCode,
              signalCode: child.signalCode,
              hasRecords: text.includes("\nmodule "),
            }).toEqual({ stderr: "", exitCode: 0, signalCode: null, hasRecords: true });
            const path = name.replace(/\.\w+$/, ".ir");
            using made = tempDir("aot-tests-made", { [path]: text });
            const counted = await expectNoTestFails(["run", ...moreFlags, path], String(made));
            expect(counted.passed + counted.todo).toBe(1);
            passed += counted.passed;
          }),
        limitOfACase,
      );
    // What `expectEveryTestPasses` holds of one command holds of the commands of a part: a part of which nothing passed has shown nothing.
    test.serial("a file of the part passes", () => expect(passed).toBeGreaterThan(0));
  });
}
